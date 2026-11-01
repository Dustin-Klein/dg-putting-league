import 'server-only';
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/errors';
import { authorizeEventAdmin, authorizeLeagueAdmin, authorizePublicRead, getViewer } from '@/lib/services/auth';
import { lockEvent, lockLeagueHandicap, withTransaction, type Executor, type Tx } from '@/lib/db/tx';
import * as handicapDb from '@/lib/repositories/handicap-repository.db';
import * as eventDb from '@/lib/repositories/event-repository.db';
import { getLeagueAdminRole, getLeagueById } from '@/lib/repositories/league-repository.db';
import { getPlayerByNumber } from '@/lib/repositories/player-statistics-repository.db';
import { isUuid } from '@/lib/utils/uuid';
import type {
  CareerDistanceStats,
  HandicapSettings,
  LeagueRosterEntry,
  PlayerHandicapAdmin,
  PlayerHandicapPublic,
  ZonePeriodAdmin,
  ZonePeriodPublic,
  ZoneSuggestion,
} from '@/lib/types/handicap';
import { combinePeriodStats, eligibilityProgress } from './stats';
import { refreshEntrySnapshots } from './snapshot';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function isLeagueAdmin(ex: Executor, leagueId: string, viewerId: string | null): Promise<boolean> {
  return viewerId !== null && (await getLeagueAdminRole(ex, leagueId, viewerId)) !== null;
}

function toPublicPeriod(period: handicapDb.ZonePeriodRow): ZonePeriodPublic {
  return {
    started_at: period.started_at,
    ended_at: period.ended_at,
    zone: period.zone,
    distance_ft: period.distance_ft,
    start_reason: period.start_reason,
    make_pct: period.end_stats?.make_pct ?? null,
  };
}

function toAdminPeriod(period: handicapDb.ZonePeriodRow): ZonePeriodAdmin {
  return {
    ...toPublicPeriod(period),
    id: period.id,
    note: period.note,
    started_by_user: period.started_by_user,
    started_by_event_id: period.started_by_event_id,
    end_stats: period.end_stats,
  };
}

/**
 * One player's handicap in one league, as two DTOs off one read. Everything in it
 * comes from completed events, which are public. The deliberate exception, recorded
 * here: the aggregate includes qualification putts, which are otherwise public only
 * while qualification runs. Notes, actors and pending demotion suggestions are
 * admin-only; a player never sees a pending suggestion.
 */
async function readPlayerHandicap(
  ex: Executor,
  playerId: string,
  leagueId: string,
  leagueName: string,
  isAdmin: boolean
): Promise<PlayerHandicapPublic | PlayerHandicapAdmin | null> {
  const [stored, zones, history] = await Promise.all([
    handicapDb.getLeagueHandicapSettings(ex, leagueId),
    handicapDb.getLeagueZones(ex, leagueId),
    handicapDb.getPeriodHistory(ex, playerId, leagueId),
  ]);
  const open = history.find((period) => period.ended_at === null);
  if (!stored || !open) return null;
  const settings = stored.settings;

  const [counts, career] = await Promise.all([
    handicapDb.getPeriodEntryCounts(ex, [open.id]),
    handicapDb.getCareerEntryCounts(ex, playerId, leagueId),
  ]);
  const stats = combinePeriodStats(counts.get(open.id) ?? [], settings);
  const nextZone = zones.find((zone) => zone.zone === open.zone + 1);

  const base = {
    league_id: leagueId,
    league_name: leagueName,
    current_zone: open.zone,
    distance_ft: zones.find((zone) => zone.zone === open.zone)?.distance_ft ?? open.distance_ft,
    max_zone: zones.length > 0 ? Math.max(...zones.map((zone) => zone.zone)) : open.zone,
    period: { since: open.started_at, stats, progress: eligibilityProgress(stats, settings) },
    promote_above_pct: settings.promote_above_pct,
    next_zone_distance_ft: nextZone?.distance_ft ?? null,
    career: careerByDistance(career, settings),
  };
  if (!isAdmin) return { ...base, history: history.map(toPublicPeriod) };

  const [suggestion] = await handicapDb.listOpenSuggestions(ex, leagueId, playerId);
  return {
    ...base,
    history: history.map(toAdminPeriod),
    open_suggestion: suggestion ?? null,
    demote_below_pct: settings.demote_below_pct,
  };
}

function careerByDistance(
  career: Map<number, import('./stats').EntryCounts[]>,
  settings: HandicapSettings
): CareerDistanceStats[] {
  return [...career.entries()]
    .map(([distance, entries]) => {
      const stats = combinePeriodStats(entries, { count_qualification_putts: settings.count_qualification_putts, window_putts: null });
      return { distance_ft: distance, putts_made: stats.putts_made, putts_attempted: stats.putts_attempted, make_pct: stats.make_pct };
    })
    .filter((row) => row.putts_attempted > 0)
    .sort((a, b) => a.distance_ft - b.distance_ft);
}

/** A player's handicap in a league. League admins get the admin DTO. */
export async function getPlayerHandicap(
  playerId: string,
  leagueId: string
): Promise<PlayerHandicapPublic | PlayerHandicapAdmin> {
  const { pg } = authorizePublicRead();
  if (!isUuid(playerId) || !isUuid(leagueId)) throw new NotFoundError('Handicap not found');
  const league = await getLeagueById(pg, leagueId);
  if (!league) throw new NotFoundError('Handicap not found');
  const viewer = await getViewer();
  const handicap = await readPlayerHandicap(pg, playerId, leagueId, league.name, await isLeagueAdmin(pg, leagueId, viewer?.id ?? null));
  if (!handicap) throw new NotFoundError('Handicap not found');
  return handicap;
}

/** Every league in which the player has a zone, for the profile page. */
export async function getPlayerHandicapsByNumber(
  playerNumber: number
): Promise<Array<PlayerHandicapPublic | PlayerHandicapAdmin>> {
  const { pg } = authorizePublicRead();
  const player = await getPlayerByNumber(pg, playerNumber);
  if (!player) throw new NotFoundError('Player not found');
  const [leagues, viewer] = await Promise.all([handicapDb.getPlayerHandicapLeagues(pg, player.id), getViewer()]);
  const results = await Promise.all(leagues.map(async (league) =>
    readPlayerHandicap(pg, player.id, league.league_id, league.league_name, await isLeagueAdmin(pg, league.league_id, viewer?.id ?? null))
  ));
  return results.filter((result): result is PlayerHandicapPublic | PlayerHandicapAdmin => result !== null);
}

/** The league roster (players with an entry or a zone in the league) with current zones. League admins only. */
export async function getLeagueHandicapRoster(leagueId: string): Promise<LeagueRosterEntry[]> {
  const { pg } = await authorizeLeagueAdmin(leagueId);
  const [stored, roster, suggestions] = await Promise.all([
    handicapDb.getLeagueHandicapSettings(pg, leagueId),
    handicapDb.getLeagueRoster(pg, leagueId),
    handicapDb.listOpenSuggestions(pg, leagueId),
  ]);
  const periodIds = roster.flatMap((row) => (row.period ? [row.period.id] : []));
  const counts = await handicapDb.getPeriodEntryCounts(pg, periodIds);
  const flagged = new Set(suggestions.map((suggestion) => suggestion.player_id));

  return roster.map((row) => {
    const stats = row.period && stored ? combinePeriodStats(counts.get(row.period.id) ?? [], stored.settings) : null;
    return {
      player_id: row.player_id,
      player_name: row.player_name,
      player_number: row.player_number,
      zone: row.period?.zone ?? null,
      distance_ft: row.period?.distance_ft ?? null,
      period_started_at: row.period?.started_at ?? null,
      stats,
      progress: stats && stored ? eligibilityProgress(stats, stored.settings) : null,
      has_open_suggestion: flagged.has(row.player_id),
    };
  });
}

/** Open demotion suggestions: the admin review queue. */
export async function listZoneSuggestions(leagueId: string): Promise<ZoneSuggestion[]> {
  const { pg } = await authorizeLeagueAdmin(leagueId);
  return handicapDb.listOpenSuggestions(pg, leagueId);
}

// ---------------------------------------------------------------------------
// Writes: an admin is the only way a player moves closer (unless the league
// enables automatic demotion), and every admin move affects future events only.
// ---------------------------------------------------------------------------

async function loadLadder(tx: Tx, leagueId: string) {
  const stored = await handicapDb.getLeagueHandicapSettings(tx, leagueId);
  if (!stored) throw new BadRequestError('Handicaps are not set up for this league');
  const zones = await handicapDb.getLeagueZones(tx, leagueId);
  return { settings: stored.settings, zones };
}

/**
 * Close the player's open period (with its stats, for the history) and open a new
 * one. Any open suggestion is superseded: the question it asked is moot.
 */
async function movePlayer(
  tx: Tx,
  leagueId: string,
  open: handicapDb.ZonePeriodRow,
  settings: HandicapSettings,
  next: handicapDb.NewZonePeriod
): Promise<void> {
  const counts = await handicapDb.getPeriodEntryCounts(tx, [open.id]);
  const stats = combinePeriodStats(counts.get(open.id) ?? [], settings);
  const closed = await handicapDb.closePeriods(tx, [{ id: open.id, end_stats: { ...stats, evaluated_event_id: null } }]);
  if (closed.length !== 1) throw new ConflictError("The player's zone just changed. Reload and try again.");
  await handicapDb.insertOpenPeriods(tx, leagueId, [next]);
}

/**
 * Open a `manual` period in `zone` for the player. With `allowSame`, a player already
 * in that zone is left as is instead of refused.
 */
async function applyPlayerZone(
  tx: Tx,
  leagueId: string,
  playerId: string,
  zone: number,
  note: string,
  userId: string,
  opts: { allowSame: boolean }
): Promise<void> {
  await lockLeagueHandicap(tx, leagueId);
  const { settings, zones } = await loadLadder(tx, leagueId);
  const target = zones.find((definition) => definition.zone === zone);
  if (!target) throw new BadRequestError(`Zone ${zone} does not exist in this league`);

  if (!isUuid(playerId) || !(await handicapDb.isPlayerInLeague(tx, leagueId, playerId))) {
    throw new NotFoundError('Player has not played in this league');
  }

  const open = (await handicapDb.getOpenPeriods(tx, leagueId, [playerId])).get(playerId);
  const next: handicapDb.NewZonePeriod = {
    player_id: playerId,
    zone: target.zone,
    distance_ft: target.distance_ft,
    start_reason: 'manual',
    started_by_user: userId,
    note,
  };
  if (!open) {
    await handicapDb.insertOpenPeriods(tx, leagueId, [next]);
  } else if (open.zone === zone) {
    if (opts.allowSame) return;
    throw new BadRequestError(`Player is already in zone ${zone}`);
  } else {
    await movePlayer(tx, leagueId, open, settings, next);
  }
  await handicapDb.supersedeOpenSuggestions(tx, leagueId, [playerId]);
}

/**
 * Put a player in a zone (league admin), with a required note. Affects future events
 * only (Q8): entries already snapshotted keep their zone, and an entry in an event
 * that has not started picks the change up at its next refresh.
 */
export async function setPlayerZone(
  leagueId: string,
  playerId: string,
  zone: number,
  note: string
): Promise<PlayerHandicapAdmin> {
  const { user, pg } = await authorizeLeagueAdmin(leagueId);
  const trimmed = note.trim();
  if (!trimmed) throw new BadRequestError('A note is required when changing a zone');

  await withTransaction(pg, (tx) => applyPlayerZone(tx, leagueId, playerId, zone, trimmed, user.id, { allowSame: false }));

  const league = await getLeagueById(pg, leagueId);
  return (await readPlayerHandicap(pg, playerId, leagueId, league?.name ?? '', true)) as PlayerHandicapAdmin;
}

/**
 * Apply (move one zone closer, as `admin_demote`) or dismiss (note required) an open
 * demotion suggestion. Under the league handicap lock the suggestion must still be
 * open and its period still the player's open period; otherwise 409, since the player
 * has moved on since the queue was rendered. A dismissed player is flagged again by
 * the next event if they stay low.
 */
export async function resolveZoneSuggestion(
  leagueId: string,
  evaluationId: string,
  action: 'apply' | 'dismiss',
  note: string | null
): Promise<void> {
  const { user, pg } = await authorizeLeagueAdmin(leagueId);
  const trimmed = note?.trim() || null;
  if (action === 'dismiss' && !trimmed) throw new BadRequestError('A note is required to dismiss a suggestion');
  if (!isUuid(evaluationId)) throw new NotFoundError('Suggestion not found');

  await withTransaction(pg, async (tx) => {
    await lockLeagueHandicap(tx, leagueId);
    const evaluation = await handicapDb.getEvaluation(tx, evaluationId);
    if (!evaluation || evaluation.league_id !== leagueId || evaluation.decision !== 'demote' || evaluation.applied) {
      throw new NotFoundError('Suggestion not found');
    }
    if (evaluation.resolution !== null) {
      throw new ConflictError('This suggestion has already been resolved');
    }
    const open = (await handicapDb.getOpenPeriods(tx, leagueId, [evaluation.player_id])).get(evaluation.player_id);
    if (!open || open.id !== evaluation.zone_period_id) {
      throw new ConflictError("The player's zone has changed since this suggestion was made");
    }

    if (action === 'apply') {
      const { settings, zones } = await loadLadder(tx, leagueId);
      const target = zones.find((zone) => zone.zone === open.zone - 1);
      if (!target) throw new ConflictError('The player is already in the closest zone');
      await movePlayer(tx, leagueId, open, settings, {
        player_id: evaluation.player_id,
        zone: target.zone,
        distance_ft: target.distance_ft,
        start_reason: 'admin_demote',
        started_by_user: user.id,
        note: trimmed,
      });
    }
    const resolved = await handicapDb.resolveEvaluation(
      tx, evaluationId, action === 'apply' ? 'applied' : 'dismissed', user.id, trimmed
    );
    if (!resolved) throw new ConflictError('This suggestion has already been resolved');
    if (action === 'apply') {
      await handicapDb.supersedeOpenSuggestions(tx, leagueId, [evaluation.player_id], { exceptEvaluationId: evaluationId });
    }
  });
}

/**
 * Move an event entry's player to a zone from the event page. The league zone changes
 * as with `setPlayerZone`; an entry without frames before the bracket also takes the
 * new zone tonight (dropping any hand-set distance). Returns whether tonight changed.
 */
export async function moveEntryZone(
  eventId: string,
  eventPlayerId: string,
  zone: number,
  note: string
): Promise<{ applied_tonight: boolean }> {
  const { user, pg } = await authorizeEventAdmin(eventId);
  const trimmed = note.trim();
  if (!trimmed) throw new BadRequestError('A note is required when changing a zone');

  return withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    // FOR UPDATE waits out an in-flight first qualification frame, as for a distance override.
    const config = await eventDb.getEventBracketConfig(tx, eventId, { lock: 'update' });
    const event = await handicapDb.getEventHandicapContext(tx, eventId);
    if (!config || !event) throw new NotFoundError('Event not found');
    if (!event.handicap_enabled) throw new BadRequestError('This event does not use handicaps');
    const [entry] = await handicapDb.getEntrySnapshotStates(tx, eventId, [eventPlayerId]);
    if (!entry) throw new NotFoundError('Player not found in this event');

    const tonight = (event.status === 'created' || event.status === 'pre-bracket') && !entry.has_frames;
    await applyPlayerZone(tx, event.league_id, entry.player_id, zone, trimmed, user.id, { allowSame: tonight });
    if (tonight) await refreshEntrySnapshots(tx, eventId, { entryIds: [entry.id] });
    return { applied_tonight: tonight };
  });
}
