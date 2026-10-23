import 'server-only';
import { InternalError } from '@/lib/errors';
import { lockLeagueHandicap, type Executor, type Tx } from '@/lib/db/tx';
import * as handicapDb from '@/lib/repositories/handicap-repository.db';
import type { EvaluationSummary, EvaluationSummaryEntry, PeriodStats } from '@/lib/types/handicap';
import { appliesAutomatically, decideZoneChange } from './decision';
import { combinePeriodStats, EMPTY_STATS } from './stats';
import { logger } from '@/lib/utils/logger';

export { decideZoneChange, appliesAutomatically, type Decision } from './decision';

/**
 * Evaluate every player of a completed handicap event (plan 06 §6), inside the
 * completion transaction. Event completion and admin action are the only two writers
 * of a zone: nothing during a live event moves anyone.
 *
 * Precondition: the event row is already `completed` in this transaction, so the
 * period queries (completed events only) include its frames.
 *
 * - The event's own flag decides (Q13): an event created, played and scored under
 *   handicaps is evaluated even if the league has since turned them off.
 * - Idempotent: every player gets an evaluation row, whatever it decides, so "this
 *   event has evaluations" means it was evaluated.
 * - A player whose entry was played under a period that has since closed is recorded
 *   as skipped ('period_changed'); an entry the organizer excluded is skipped
 *   ('excluded') and not decided on earlier events' evidence either.
 * - Promotions are applied; demotions are applied only with `auto_demote_enabled`,
 *   otherwise they stay open as suggestions for an admin.
 * - An eligible evaluation supersedes the player's open suggestion, before the new
 *   row is inserted (so a new demotion doesn't supersede itself).
 */
export async function evaluateEventHandicaps(tx: Tx, eventId: string): Promise<EvaluationSummary | null> {
  const event = await handicapDb.getEventHandicapContext(tx, eventId);
  if (!event) throw new InternalError('Event not found for handicap evaluation');
  if (!event.handicap_enabled) return null;
  if (event.status !== 'completed') {
    throw new InternalError('Handicaps are evaluated only once the event is completed');
  }
  if (await handicapDb.hasEvaluationsForEvent(tx, eventId)) {
    return getEvaluationSummary(tx, eventId);
  }

  await lockLeagueHandicap(tx, event.league_id);
  const stored = await handicapDb.getLeagueHandicapSettings(tx, event.league_id);
  if (!stored) throw new InternalError('Handicap event in a league without handicap settings');
  const settings = stored.settings;
  const zones = await handicapDb.getLeagueZones(tx, event.league_id);
  const distanceOf = new Map(zones.map((zone) => [zone.zone, zone.distance_ft]));
  const maxZone = Math.max(...zones.map((zone) => zone.zone));

  const entries = await handicapDb.getEntriesForEvaluation(tx, eventId);
  const openPeriods = await handicapDb.getOpenPeriods(tx, event.league_id, entries.map((entry) => entry.player_id));
  const periodIds = new Set<string>();
  for (const entry of entries) {
    const open = openPeriods.get(entry.player_id);
    if (open) periodIds.add(open.id);
    if (entry.zone_period_id) periodIds.add(entry.zone_period_id);
  }
  const counts = await handicapDb.getPeriodEntryCounts(tx, [...periodIds]);
  const statsOf = (periodId: string): PeriodStats => combinePeriodStats(counts.get(periodId) ?? [], settings);

  const evaluations: handicapDb.NewZoneEvaluation[] = [];
  const supersede: string[] = [];
  const closures: Array<{ id: string; end_stats: Record<string, unknown> }> = [];
  const moves: handicapDb.NewZonePeriod[] = [];

  for (const entry of entries) {
    const period = openPeriods.get(entry.player_id);
    if (!period) {
      // Every handicap entry is snapshotted with an open period; nothing to record against.
      logger.warn('Handicap entry without an open zone period', { eventId, playerId: entry.player_id });
      continue;
    }

    const skip = entry.zone_period_id !== period.id
      ? 'period_changed' as const
      : entry.exclude_from_handicap ? 'excluded' as const : null;
    if (skip) {
      const periodId = entry.zone_period_id ?? period.id;
      evaluations.push({
        event_id: eventId,
        player_id: entry.player_id,
        zone_period_id: periodId,
        zone: entry.zone ?? period.zone,
        stats: periodIds.has(periodId) ? statsOf(periodId) : EMPTY_STATS,
        decision: 'stay',
        eligible: false,
        applied: false,
        skip_reason: skip,
      });
      continue;
    }

    const stats = statsOf(period.id);
    const decision = decideZoneChange(stats, settings, period.zone, maxZone);
    const apply = appliesAutomatically(decision.action, settings);
    if (decision.eligible) supersede.push(entry.player_id);
    evaluations.push({
      event_id: eventId,
      player_id: entry.player_id,
      zone_period_id: period.id,
      zone: period.zone,
      stats,
      decision: decision.action,
      eligible: decision.eligible,
      applied: apply,
      skip_reason: null,
    });
    if (!apply) continue;

    const newZone = period.zone + (decision.action === 'promote' ? 1 : -1);
    const newDistance = distanceOf.get(newZone);
    if (newDistance === undefined) throw new InternalError(`League zone ${newZone} has no distance`);
    closures.push({ id: period.id, end_stats: { ...stats, evaluated_event_id: eventId } });
    moves.push({
      player_id: entry.player_id,
      zone: newZone,
      distance_ft: newDistance,
      start_reason: decision.action === 'promote' ? 'auto_promote' : 'auto_demote',
      started_by_event_id: eventId,
    });
  }

  await handicapDb.supersedeOpenSuggestions(tx, event.league_id, supersede);
  await handicapDb.insertEvaluations(tx, event.league_id, evaluations);
  const closed = await handicapDb.closePeriods(tx, closures);
  if (closed.length !== closures.length) {
    throw new InternalError('A zone period changed during evaluation');
  }
  await handicapDb.insertOpenPeriods(tx, event.league_id, moves);

  return getEvaluationSummary(tx, eventId);
}

/** What an event's evaluation did, for the admin summary after completion. */
export async function getEvaluationSummary(ex: Executor, eventId: string): Promise<EvaluationSummary> {
  const rows = await handicapDb.getEventEvaluations(ex, eventId);
  const summary: EvaluationSummary = {
    event_id: eventId,
    moved_up: [],
    moved_down: [],
    flagged: [],
    unchanged: 0,
    skipped: [],
  };
  for (const row of rows) {
    const entry: EvaluationSummaryEntry = {
      player_id: row.player_id,
      player_name: row.player_name,
      zone: row.zone,
      new_zone: row.new_zone,
      decision: row.decision,
      eligible: row.eligible,
      applied: row.applied,
      skip_reason: row.skip_reason,
      make_pct: row.stats.make_pct,
      putts_attempted: row.stats.putts_attempted,
    };
    if (row.skip_reason) summary.skipped.push(entry);
    else if (row.applied && row.decision === 'promote') summary.moved_up.push(entry);
    else if (row.applied && row.decision === 'demote') summary.moved_down.push(entry);
    else if (row.decision === 'demote') summary.flagged.push(entry);
    else summary.unchanged += 1;
  }
  return summary;
}
