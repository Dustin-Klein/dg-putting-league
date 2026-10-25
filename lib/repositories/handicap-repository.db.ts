import 'server-only';
import { and, asc, count, desc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { chunks } from '@/lib/db/batch';
import { toIsoTimestamp, toNumber } from '@/lib/db/mappers';
import {
  bracket_match,
  event_players,
  event_zone_distances,
  events,
  frame_results,
  league_handicap_settings,
  league_handicap_zones,
  leagues,
  player_zone_evaluations,
  player_zone_periods,
  players,
  qualification_frames,
} from '@/lib/db/schema';
import type {
  HandicapSettings,
  PeriodStats,
  ZoneChangeReason,
  ZoneDecision,
  ZoneDefinition,
  ZoneEvaluation,
  ZoneSkipReason,
  ZoneSuggestion,
  ZoneSuggestionResolution,
} from '@/lib/types/handicap';
import type { EventStatus } from '@/lib/types/event';
import type { EntryCounts } from '@/lib/services/handicap/stats';

/** bracket_match.status values that mean "finished": Completed and Archived. */
const FINISHED_MATCH_STATUSES = [4, 5];

// ---------------------------------------------------------------------------
// League settings and nominal ladder
// ---------------------------------------------------------------------------

export interface StoredHandicapSettings {
  settings: HandicapSettings;
  updated_at: string;
}

export async function getLeagueHandicapSettings(
  ex: Executor,
  leagueId: string
): Promise<StoredHandicapSettings | null> {
  const [row] = await ex.select().from(league_handicap_settings)
    .where(eq(league_handicap_settings.league_id, leagueId)).limit(1);
  if (!row) return null;
  return {
    settings: {
      enabled: row.enabled,
      default_zone: row.default_zone,
      demote_below_pct: toNumber(row.demote_below_pct),
      promote_above_pct: toNumber(row.promote_above_pct),
      min_putts: row.min_putts,
      min_matches: row.min_matches,
      window_putts: row.window_putts,
      count_qualification_putts: row.count_qualification_putts,
      auto_demote_enabled: row.auto_demote_enabled,
    },
    updated_at: toIsoTimestamp(row.updated_at),
  };
}

export async function upsertLeagueHandicapSettings(
  ex: Executor,
  leagueId: string,
  settings: HandicapSettings,
  userId: string
): Promise<void> {
  const values = {
    enabled: settings.enabled,
    default_zone: settings.default_zone,
    demote_below_pct: String(settings.demote_below_pct),
    promote_above_pct: String(settings.promote_above_pct),
    min_putts: settings.min_putts,
    min_matches: settings.min_matches,
    window_putts: settings.window_putts,
    count_qualification_putts: settings.count_qualification_putts,
    auto_demote_enabled: settings.auto_demote_enabled,
    updated_at: sql`now()`,
    updated_by: userId,
  };
  await ex.insert(league_handicap_settings).values({ league_id: leagueId, ...values })
    .onConflictDoUpdate({ target: league_handicap_settings.league_id, set: values });
}

export async function getLeagueZones(ex: Executor, leagueId: string): Promise<ZoneDefinition[]> {
  const rows = await ex.select({ zone: league_handicap_zones.zone, distance_ft: league_handicap_zones.distance_ft })
    .from(league_handicap_zones)
    .where(eq(league_handicap_zones.league_id, leagueId))
    .orderBy(asc(league_handicap_zones.zone));
  return rows.map((row) => ({ zone: row.zone, distance_ft: toNumber(row.distance_ft) }));
}

/** Replace the league's ladder with `zones` (callers validate and check zones in use). */
export async function replaceLeagueZones(ex: Executor, leagueId: string, zones: readonly ZoneDefinition[]): Promise<void> {
  await ex.delete(league_handicap_zones).where(and(
    eq(league_handicap_zones.league_id, leagueId),
    zones.length > 0 ? notInArray(league_handicap_zones.zone, zones.map((zone) => zone.zone)) : undefined
  ));
  if (zones.length === 0) return;
  await ex.insert(league_handicap_zones)
    .values(zones.map((zone) => ({ league_id: leagueId, zone: zone.zone, distance_ft: String(zone.distance_ft) })))
    .onConflictDoUpdate({
      target: [league_handicap_zones.league_id, league_handicap_zones.zone],
      set: { distance_ft: sql`excluded.distance_ft` },
    });
}

/** Zones a period or an event entry in this league refers to (they can't be removed). */
export async function getZonesInUse(ex: Executor, leagueId: string): Promise<Set<number>> {
  const [periodZones, entryZones] = await Promise.all([
    ex.selectDistinct({ zone: player_zone_periods.zone }).from(player_zone_periods)
      .where(eq(player_zone_periods.league_id, leagueId)),
    ex.selectDistinct({ zone: event_players.zone }).from(event_players)
      .innerJoin(events, eq(events.id, event_players.event_id))
      .where(and(eq(events.league_id, leagueId), sql`${event_players.zone} is not null`)),
  ]);
  return new Set([...periodZones, ...entryZones].map((row) => row.zone as number));
}

// ---------------------------------------------------------------------------
// Events: the flag and tonight's distances
// ---------------------------------------------------------------------------

export interface EventHandicapContext {
  id: string;
  league_id: string;
  status: EventStatus;
  handicap_enabled: boolean;
  putt_distance_ft: number;
  parent_event_id: string | null;
}

export async function getEventHandicapContext(ex: Executor, eventId: string): Promise<EventHandicapContext | null> {
  const [row] = await ex.select({
    id: events.id,
    league_id: events.league_id,
    status: events.status,
    handicap_enabled: events.handicap_enabled,
    putt_distance_ft: events.putt_distance_ft,
    parent_event_id: events.parent_event_id,
  }).from(events).where(eq(events.id, eventId)).limit(1);
  return row ? { ...row, putt_distance_ft: toNumber(row.putt_distance_ft) } : null;
}

export async function setEventHandicapEnabled(ex: Executor, eventId: string, enabled: boolean): Promise<void> {
  await ex.update(events).set({ handicap_enabled: enabled }).where(eq(events.id, eventId));
}

export async function getEventZoneDistances(ex: Executor, eventId: string): Promise<ZoneDefinition[]> {
  const rows = await ex.select({ zone: event_zone_distances.zone, distance_ft: event_zone_distances.distance_ft })
    .from(event_zone_distances)
    .where(eq(event_zone_distances.event_id, eventId))
    .orderBy(asc(event_zone_distances.zone));
  return rows.map((row) => ({ zone: row.zone, distance_ft: toNumber(row.distance_ft) }));
}

export async function replaceEventZoneDistances(
  ex: Executor,
  eventId: string,
  zones: readonly ZoneDefinition[]
): Promise<void> {
  await ex.delete(event_zone_distances).where(eq(event_zone_distances.event_id, eventId));
  if (zones.length === 0) return;
  await ex.insert(event_zone_distances)
    .values(zones.map((zone) => ({ event_id: eventId, zone: zone.zone, distance_ft: String(zone.distance_ft) })));
}

/** Whether any frame (bracket or qualification) has been recorded for the event. */
export async function eventHasFrames(ex: Executor, eventId: string): Promise<boolean> {
  const rows = await ex.execute<{ has_frames: boolean }>(sql`
    select exists (
      select 1 from ${frame_results} fr
      join ${event_players} ep on ep.id = fr.event_player_id
      where ep.event_id = ${eventId}
    ) or exists (
      select 1 from ${qualification_frames} qf where qf.event_id = ${eventId}
    ) as has_frames`);
  return Boolean(rows[0]?.has_frames);
}

// ---------------------------------------------------------------------------
// Zone periods
// ---------------------------------------------------------------------------

export interface ZonePeriodRow {
  id: string;
  player_id: string;
  league_id: string;
  zone: number;
  distance_ft: number;
  started_at: string;
  start_reason: ZoneChangeReason;
  started_by_event_id: string | null;
  started_by_user: string | null;
  ended_at: string | null;
  end_stats: (PeriodStats & { evaluated_event_id?: string | null }) | null;
  note: string | null;
}

function mapPeriod(row: typeof player_zone_periods.$inferSelect): ZonePeriodRow {
  return {
    id: row.id,
    player_id: row.player_id,
    league_id: row.league_id,
    zone: row.zone,
    distance_ft: toNumber(row.distance_ft),
    started_at: toIsoTimestamp(row.started_at),
    start_reason: row.start_reason,
    started_by_event_id: row.started_by_event_id,
    started_by_user: row.started_by_user,
    ended_at: toIsoTimestamp(row.ended_at),
    end_stats: row.end_stats as ZonePeriodRow['end_stats'],
    note: row.note,
  };
}

/** Open periods (current zones) of the given players in a league, keyed by player id. */
export async function getOpenPeriods(
  ex: Executor,
  leagueId: string,
  playerIds: readonly string[]
): Promise<Map<string, ZonePeriodRow>> {
  if (playerIds.length === 0) return new Map();
  const rows = await ex.select().from(player_zone_periods).where(and(
    eq(player_zone_periods.league_id, leagueId),
    inArray(player_zone_periods.player_id, [...new Set(playerIds)]),
    isNull(player_zone_periods.ended_at)
  ));
  return new Map(rows.map((row) => [row.player_id, mapPeriod(row)]));
}

export interface NewZonePeriod {
  player_id: string;
  zone: number;
  distance_ft: number;
  start_reason: ZoneChangeReason;
  started_by_event_id?: string | null;
  started_by_user?: string | null;
  note?: string | null;
}

/**
 * Open periods. A player who already has an open period in the league is skipped
 * (the partial unique index is the backstop; callers hold the league handicap lock),
 * so callers read the open periods back afterwards.
 */
export async function insertOpenPeriods(ex: Executor, leagueId: string, periods: readonly NewZonePeriod[]): Promise<void> {
  for (const batch of chunks(periods)) {
    await ex.insert(player_zone_periods).values(batch.map((period) => ({
      player_id: period.player_id,
      league_id: leagueId,
      zone: period.zone,
      distance_ft: String(period.distance_ft),
      start_reason: period.start_reason,
      started_by_event_id: period.started_by_event_id ?? null,
      started_by_user: period.started_by_user ?? null,
      note: period.note ?? null,
    }))).onConflictDoNothing({
      target: [player_zone_periods.player_id, player_zone_periods.league_id],
      where: sql`ended_at is null`,
    });
  }
}

/** Close open periods with the stats that ended them. Returns the ids actually closed. */
export async function closePeriods(
  ex: Executor,
  closures: ReadonlyArray<{ id: string; end_stats: Record<string, unknown> }>
): Promise<string[]> {
  const closed: string[] = [];
  for (const batch of chunks(closures)) {
    const values = sql.join(batch.map((c) => sql`(${c.id}::uuid, ${JSON.stringify(c.end_stats)}::jsonb)`), sql`, `);
    const rows = await ex.execute<{ id: string }>(sql`
      update ${player_zone_periods} as p
      set ended_at = now(), end_stats = v.end_stats
      from (values ${values}) as v(id, end_stats)
      where p.id = v.id and p.ended_at is null
      returning p.id`);
    closed.push(...rows.map((row) => row.id));
  }
  return closed;
}

export async function getPeriodHistory(ex: Executor, playerId: string, leagueId: string): Promise<ZonePeriodRow[]> {
  const rows = await ex.select().from(player_zone_periods)
    .where(and(eq(player_zone_periods.player_id, playerId), eq(player_zone_periods.league_id, leagueId)))
    .orderBy(asc(player_zone_periods.started_at));
  return rows.map(mapPeriod);
}

/** Leagues in which the player has a zone, by league name. */
export async function getPlayerHandicapLeagues(
  ex: Executor,
  playerId: string
): Promise<Array<{ league_id: string; league_name: string }>> {
  return ex.selectDistinct({ league_id: leagues.id, league_name: leagues.name })
    .from(player_zone_periods)
    .innerJoin(leagues, eq(leagues.id, player_zone_periods.league_id))
    .where(eq(player_zone_periods.player_id, playerId))
    .orderBy(asc(leagues.name), asc(leagues.id));
}

// ---------------------------------------------------------------------------
// Entry snapshots
// ---------------------------------------------------------------------------

export interface EntrySnapshotState {
  id: string;
  player_id: string;
  zone: number | null;
  zone_period_id: string | null;
  putt_distance_ft: number;
  distance_override: boolean;
  exclude_from_handicap: boolean;
  has_frames: boolean;
}

const entryHasFrames = sql<boolean>`(exists (select 1 from ${frame_results} fr where fr.event_player_id = ${event_players.id})
  or exists (select 1 from ${qualification_frames} qf where qf.event_player_id = ${event_players.id}))`;

/** The event's entries (or the given ones) with their snapshot and whether they have frames. */
export async function getEntrySnapshotStates(
  ex: Executor,
  eventId: string,
  entryIds?: readonly string[]
): Promise<EntrySnapshotState[]> {
  if (entryIds && entryIds.length === 0) return [];
  const rows = await ex.select({
    id: event_players.id,
    player_id: event_players.player_id,
    zone: event_players.zone,
    zone_period_id: event_players.zone_period_id,
    putt_distance_ft: event_players.putt_distance_ft,
    distance_override: event_players.distance_override,
    exclude_from_handicap: event_players.exclude_from_handicap,
    has_frames: entryHasFrames,
  }).from(event_players).where(and(
    eq(event_players.event_id, eventId),
    entryIds ? inArray(event_players.id, [...entryIds]) : undefined
  ));
  return rows.map((row) => ({ ...row, putt_distance_ft: toNumber(row.putt_distance_ft), has_frames: Boolean(row.has_frames) }));
}

export interface EntrySnapshot {
  id: string;
  zone: number | null;
  zone_period_id: string | null;
  putt_distance_ft: number;
  distance_override: boolean;
}

/**
 * Write entry snapshots in one statement per chunk. An entry with a recorded frame
 * is never changed (the first putt freezes the snapshot), whatever the caller read.
 * Returns the ids actually updated.
 */
export async function applyEntrySnapshots(
  ex: Executor,
  eventId: string,
  snapshots: readonly EntrySnapshot[]
): Promise<string[]> {
  const updated: string[] = [];
  for (const batch of chunks(snapshots)) {
    const values = sql.join(
      batch.map((s) => sql`(${s.id}::uuid, ${s.zone}::smallint, ${s.zone_period_id}::uuid, ${String(s.putt_distance_ft)}::numeric, ${s.distance_override}::boolean)`),
      sql`, `
    );
    const rows = await ex.execute<{ id: string }>(sql`
      update ${event_players} as ep
      set zone = v.zone, zone_period_id = v.zone_period_id,
          putt_distance_ft = v.putt_distance_ft, distance_override = v.distance_override
      from (values ${values}) as v(id, zone, zone_period_id, putt_distance_ft, distance_override)
      where ep.id = v.id and ep.event_id = ${eventId}
        and not exists (select 1 from ${frame_results} fr where fr.event_player_id = ep.id)
        and not exists (select 1 from ${qualification_frames} qf where qf.event_player_id = ep.id)
      returning ep.id`);
    updated.push(...rows.map((row) => row.id));
  }
  return updated;
}

export async function setEntryExclusion(
  ex: Executor,
  eventId: string,
  eventPlayerId: string,
  patch: { exclude_from_handicap?: boolean; handicap_note?: string | null }
): Promise<boolean> {
  if (Object.keys(patch).length === 0) return true;
  const rows = await ex.update(event_players).set(patch)
    .where(and(eq(event_players.id, eventPlayerId), eq(event_players.event_id, eventId)))
    .returning({ id: event_players.id });
  return rows.length > 0;
}

export interface EvaluationEntry {
  id: string;
  player_id: string;
  player_name: string;
  zone: number | null;
  zone_period_id: string | null;
  exclude_from_handicap: boolean;
}

export async function getEntriesForEvaluation(ex: Executor, eventId: string): Promise<EvaluationEntry[]> {
  return ex.select({
    id: event_players.id,
    player_id: event_players.player_id,
    player_name: players.full_name,
    zone: event_players.zone,
    zone_period_id: event_players.zone_period_id,
    exclude_from_handicap: event_players.exclude_from_handicap,
  }).from(event_players)
    .innerJoin(players, eq(players.id, event_players.player_id))
    .where(eq(event_players.event_id, eventId))
    .orderBy(asc(players.full_name), asc(event_players.id));
}

// ---------------------------------------------------------------------------
// Stats (aggregated on read; see lib/services/handicap/stats.ts)
// ---------------------------------------------------------------------------

type CountsRow = {
  key: string;
  event_id: string;
  event_date: string;
  event_created_at: string;
  frames: string | number;
  frame_putts_made: string | number;
  qualification_frames: string | number;
  qualification_putts_made: string | number;
  matches: string | number;
};

function mapCounts(row: CountsRow): EntryCounts {
  return {
    event_id: row.event_id,
    event_date: String(row.event_date),
    event_created_at: toIsoTimestamp(String(row.event_created_at)),
    frames: Number(row.frames),
    frame_putts_made: Number(row.frame_putts_made),
    qualification_frames: Number(row.qualification_frames),
    qualification_putts_made: Number(row.qualification_putts_made),
    matches: Number(row.matches),
  };
}

/** Per-entry counts as lateral subqueries, so frames and qualification frames don't multiply. */
const entryCountColumns = sql`
  e.id as event_id, e.event_date, e.created_at as event_created_at,
  coalesce(f.frames, 0) as frames, coalesce(f.putts_made, 0) as frame_putts_made,
  coalesce(q.frames, 0) as qualification_frames, coalesce(q.putts_made, 0) as qualification_putts_made,
  coalesce(m.matches, 0) as matches`;

const entryCountJoins = sql`
  join ${events} e on e.id = ep.event_id
  left join lateral (
    select count(*) as frames, sum(fr.putts_made) as putts_made
    from ${frame_results} fr where fr.event_player_id = ep.id
  ) f on true
  left join lateral (
    select count(*) as frames, sum(qf.putts_made) as putts_made
    from ${qualification_frames} qf where qf.event_player_id = ep.id
  ) q on true
  left join lateral (
    select count(distinct fr.bracket_match_id) as matches
    from ${frame_results} fr
    join ${bracket_match} bm on bm.id = fr.bracket_match_id
    where fr.event_player_id = ep.id and bm.status in (${sql.join(FINISHED_MATCH_STATUSES.map((s) => sql`${s}`), sql`, `)})
  ) m on true`;

/**
 * Per-entry counts for each period, in one statement for the whole set: entries
 * played under the period, not excluded, in completed events.
 */
export async function getPeriodEntryCounts(
  ex: Executor,
  periodIds: readonly string[]
): Promise<Map<string, EntryCounts[]>> {
  const result = new Map<string, EntryCounts[]>(periodIds.map((id) => [id, []]));
  if (periodIds.length === 0) return result;
  const ids = sql.join([...new Set(periodIds)].map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await ex.execute<CountsRow>(sql`
    select ep.zone_period_id as key, ${entryCountColumns}
    from ${event_players} ep
    ${entryCountJoins}
    where ep.zone_period_id in (${ids})
      and not ep.exclude_from_handicap
      and e.status = 'completed'`);
  for (const row of rows) result.get(row.key)?.push(mapCounts(row));
  return result;
}

/**
 * A player's completed-event entries grouped by the distance actually putted (one
 * league, or every league). Excluded entries count here: career stats are a record
 * of what happened, not evidence for a zone.
 */
export async function getCareerEntryCounts(
  ex: Executor,
  playerId: string,
  leagueId: string | null
): Promise<Map<number, EntryCounts[]>> {
  const rows = await ex.execute<CountsRow>(sql`
    select ep.putt_distance_ft::text as key, ${entryCountColumns}
    from ${event_players} ep
    ${entryCountJoins}
    where ep.player_id = ${playerId}
      and e.status = 'completed'
      ${leagueId ? sql`and e.league_id = ${leagueId}` : sql``}`);
  const result = new Map<number, EntryCounts[]>();
  for (const row of rows) {
    const distance = Number(row.key);
    const list = result.get(distance) ?? [];
    list.push(mapCounts(row));
    result.set(distance, list);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Evaluations and the suggestion queue
// ---------------------------------------------------------------------------

function mapEvaluation(row: typeof player_zone_evaluations.$inferSelect): ZoneEvaluation {
  return {
    id: row.id,
    event_id: row.event_id,
    player_id: row.player_id,
    league_id: row.league_id,
    zone_period_id: row.zone_period_id,
    zone: row.zone,
    stats: row.stats as PeriodStats,
    decision: row.decision,
    eligible: row.eligible,
    applied: row.applied,
    resolution: row.resolution,
    resolved_at: toIsoTimestamp(row.resolved_at),
    resolved_by: row.resolved_by,
    resolution_note: row.resolution_note,
    skip_reason: row.skip_reason as ZoneSkipReason | null,
    created_at: toIsoTimestamp(row.created_at),
  };
}

export async function hasEvaluationsForEvent(ex: Executor, eventId: string): Promise<boolean> {
  const rows = await ex.select({ id: player_zone_evaluations.id }).from(player_zone_evaluations)
    .where(eq(player_zone_evaluations.event_id, eventId)).limit(1);
  return rows.length > 0;
}

export interface NewZoneEvaluation {
  event_id: string;
  player_id: string;
  zone_period_id: string;
  zone: number;
  stats: PeriodStats;
  decision: ZoneDecision;
  eligible: boolean;
  applied: boolean;
  skip_reason: ZoneSkipReason | null;
}

export async function insertEvaluations(
  ex: Executor,
  leagueId: string,
  evaluations: readonly NewZoneEvaluation[]
): Promise<void> {
  for (const batch of chunks(evaluations)) {
    await ex.insert(player_zone_evaluations).values(batch.map((e) => ({ ...e, league_id: leagueId })));
  }
}

const openSuggestion = and(
  eq(player_zone_evaluations.decision, 'demote'),
  eq(player_zone_evaluations.applied, false),
  isNull(player_zone_evaluations.resolution)
);

/** Mark the players' open demotion suggestions superseded by newer information. */
export async function supersedeOpenSuggestions(
  ex: Executor,
  leagueId: string,
  playerIds: readonly string[],
  opts: { exceptEvaluationId?: string } = {}
): Promise<void> {
  if (playerIds.length === 0) return;
  await ex.update(player_zone_evaluations)
    .set({ resolution: 'superseded', resolved_at: sql`now()` })
    .where(and(
      eq(player_zone_evaluations.league_id, leagueId),
      inArray(player_zone_evaluations.player_id, [...new Set(playerIds)]),
      openSuggestion,
      opts.exceptEvaluationId ? ne(player_zone_evaluations.id, opts.exceptEvaluationId) : undefined
    ));
}

export async function getEvaluation(ex: Executor, evaluationId: string): Promise<ZoneEvaluation | null> {
  const [row] = await ex.select().from(player_zone_evaluations)
    .where(eq(player_zone_evaluations.id, evaluationId)).limit(1);
  return row ? mapEvaluation(row) : null;
}

/** Resolve an open suggestion; false when it was no longer open. */
export async function resolveEvaluation(
  ex: Executor,
  evaluationId: string,
  resolution: ZoneSuggestionResolution,
  userId: string,
  note: string | null
): Promise<boolean> {
  const rows = await ex.update(player_zone_evaluations)
    .set({ resolution, resolved_at: sql`now()`, resolved_by: userId, resolution_note: note })
    .where(and(eq(player_zone_evaluations.id, evaluationId), openSuggestion))
    .returning({ id: player_zone_evaluations.id });
  return rows.length > 0;
}

/** Open demotion suggestions in a league, newest first, with context for the queue. */
export async function listOpenSuggestions(
  ex: Executor,
  leagueId: string,
  playerId?: string
): Promise<ZoneSuggestion[]> {
  const rows = await ex.select({
    evaluation: player_zone_evaluations,
    player_name: players.full_name,
    player_number: players.player_number,
    event_date: events.event_date,
    distance_ft: player_zone_periods.distance_ft,
    period_started_at: player_zone_periods.started_at,
  }).from(player_zone_evaluations)
    .innerJoin(players, eq(players.id, player_zone_evaluations.player_id))
    .innerJoin(events, eq(events.id, player_zone_evaluations.event_id))
    .innerJoin(player_zone_periods, eq(player_zone_periods.id, player_zone_evaluations.zone_period_id))
    .where(and(
      eq(player_zone_evaluations.league_id, leagueId),
      openSuggestion,
      playerId ? eq(player_zone_evaluations.player_id, playerId) : undefined
    ))
    .orderBy(desc(player_zone_evaluations.created_at));

  const playerIds = [...new Set(rows.map((row) => row.evaluation.player_id))];
  const flagCounts = playerIds.length === 0 ? [] : await ex.select({
    player_id: player_zone_evaluations.player_id,
    flags: count(),
  }).from(player_zone_evaluations)
    .where(and(
      eq(player_zone_evaluations.league_id, leagueId),
      inArray(player_zone_evaluations.player_id, playerIds),
      eq(player_zone_evaluations.decision, 'demote'),
      eq(player_zone_evaluations.applied, false)
    ))
    .groupBy(player_zone_evaluations.player_id);
  const flagsByPlayer = new Map(flagCounts.map((row) => [row.player_id, Number(row.flags)]));

  return rows.map((row) => ({
    evaluation_id: row.evaluation.id,
    player_id: row.evaluation.player_id,
    player_name: row.player_name,
    player_number: row.player_number,
    event_id: row.evaluation.event_id,
    event_date: row.event_date,
    zone: row.evaluation.zone,
    distance_ft: toNumber(row.distance_ft),
    period_started_at: toIsoTimestamp(row.period_started_at),
    stats: row.evaluation.stats as PeriodStats,
    previous_flags: Math.max(0, (flagsByPlayer.get(row.evaluation.player_id) ?? 1) - 1),
    created_at: toIsoTimestamp(row.evaluation.created_at),
  }));
}

export interface EventEvaluationRow extends ZoneEvaluation {
  player_name: string;
  /** Zone of the period this event's evaluation opened, if it moved the player. */
  new_zone: number | null;
}

export async function getEventEvaluations(ex: Executor, eventId: string): Promise<EventEvaluationRow[]> {
  const rows = await ex.select({
    evaluation: player_zone_evaluations,
    player_name: players.full_name,
    new_zone: player_zone_periods.zone,
  }).from(player_zone_evaluations)
    .innerJoin(players, eq(players.id, player_zone_evaluations.player_id))
    .leftJoin(player_zone_periods, and(
      eq(player_zone_periods.player_id, player_zone_evaluations.player_id),
      eq(player_zone_periods.league_id, player_zone_evaluations.league_id),
      eq(player_zone_periods.started_by_event_id, player_zone_evaluations.event_id)
    ))
    .where(eq(player_zone_evaluations.event_id, eventId))
    .orderBy(asc(players.full_name));
  return rows.map((row) => ({ ...mapEvaluation(row.evaluation), player_name: row.player_name, new_zone: row.new_zone }));
}

// ---------------------------------------------------------------------------
// League roster (players are global; a league's roster is everyone with an entry)
// ---------------------------------------------------------------------------

export interface RosterRow {
  player_id: string;
  player_name: string;
  player_number: number;
  period: ZonePeriodRow | null;
}

/** Whether the player has an entry or a zone in the league. */
export async function isPlayerInLeague(ex: Executor, leagueId: string, playerId: string): Promise<boolean> {
  const rows = await ex.execute<{ in_league: boolean }>(sql`
    select exists (
      select 1 from ${event_players} ep join ${events} e on e.id = ep.event_id
      where ep.player_id = ${playerId} and e.league_id = ${leagueId}
    ) or exists (
      select 1 from ${player_zone_periods} zp where zp.player_id = ${playerId} and zp.league_id = ${leagueId}
    ) as in_league`);
  return Boolean(rows[0]?.in_league);
}

export async function getLeagueRoster(ex: Executor, leagueId: string): Promise<RosterRow[]> {
  const rows = await ex.execute<{ player_id: string; full_name: string; player_number: number }>(sql`
    select p.id as player_id, p.full_name, p.player_number
    from ${players} p
    where exists (
      select 1 from ${event_players} ep join ${events} e on e.id = ep.event_id
      where ep.player_id = p.id and e.league_id = ${leagueId}
    ) or exists (
      select 1 from ${player_zone_periods} zp where zp.player_id = p.id and zp.league_id = ${leagueId}
    )
    order by p.full_name, p.id`);
  const periods = await getOpenPeriods(ex, leagueId, rows.map((row) => row.player_id));
  return rows.map((row) => ({
    player_id: row.player_id,
    player_name: row.full_name,
    player_number: Number(row.player_number),
    period: periods.get(row.player_id) ?? null,
  }));
}
