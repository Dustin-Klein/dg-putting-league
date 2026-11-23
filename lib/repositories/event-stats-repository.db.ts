import 'server-only';
import { sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import {
  bracket_group,
  bracket_match,
  bracket_participant,
  bracket_round,
  bracket_stage,
  event_placements,
  event_players,
  event_zone_distances,
  events,
  frame_results,
  lanes,
  leagues,
  match_frames,
  player_zone_periods,
  players,
  qualification_frames,
  qualification_rounds,
  team_member_substitutions,
  team_members,
  teams,
} from '@/lib/db/schema';
import type { EventLinkType, EventStatus } from '@/lib/types/event';
import type { BracketFormat } from '@/lib/brackets/format';

// Raw counts only: every metric is derived in lib/services/event-stats from these rows.

export interface StatsEventRow {
  id: string;
  league_id: string;
  league_name: string;
  event_date: string;
  created_at: string;
  location: string | null;
  status: EventStatus;
  bonus_point_enabled: boolean;
  bracket_frame_count: number;
  team_size: number;
  handicap_enabled: boolean;
  putt_distance_ft: number;
  putt_counts_reliable: boolean;
  parent_event_id: string | null;
  link_type: EventLinkType | null;
  bracket_format: BracketFormat;
  double_grand_final: boolean;
  qualification_round_enabled: boolean;
}

export interface StatsEntryRow {
  id: string;
  player_id: string;
  player_number: number;
  full_name: string;
  zone: number | null;
  putt_distance_ft: number;
  team_id: string | null;
  slot: number | null;
}

export interface StatsTeamRow {
  id: string;
  seed: number | null;
  placement: number | null;
}

export interface StatsMatchRow {
  id: number;
  number: number;
  status: number;
  opponent1: unknown;
  opponent2: unknown;
  score_override_1: number | null;
  score_override_2: number | null;
  group_id: number;
  group_number: number;
  round_id: number;
  round_number: number;
  last_round_of_group: number;
  team1_id: string | null;
  team2_id: string | null;
  lane_label: string | null;
  frame_count: number;
}

/** One entry's frames in one match, split by overtime and by the frame's zone stamp. */
export interface StatsFrameAgg {
  entry_id: string;
  match_id: number;
  overtime: boolean;
  /** Zone of the frame's stamped period (null without handicaps). */
  zone: number | null;
  distance_ft: number;
  frames: number;
  made: number;
  points: number;
  made0: number;
  made1: number;
  made2: number;
  made3: number;
}

export interface StatsLinkedEvent {
  id: string;
  status: EventStatus;
  event_date: string;
  link_type: EventLinkType | null;
}

export interface EventStatsSnapshot {
  event: StatsEventRow;
  stageType: string | null;
  entries: StatsEntryRow[];
  teams: StatsTeamRow[];
  matches: StatsMatchRow[];
  frames: StatsFrameAgg[];
  zoneDistances: { zone: number; distance_ft: number }[];
  parent: StatsLinkedEvent | null;
  children: StatsLinkedEvent[];
}

/**
 * Everything event-local, in one statement (one consistent snapshot even outside a
 * transaction). Frames are read only through this event's bracket matches.
 */
export async function getEventStatsSnapshot(ex: Executor, eventId: string): Promise<EventStatsSnapshot | null> {
  const participantId = (opponent: string) =>
    sql.raw(`case when jsonb_typeof(bm.${opponent}->'id') = 'number' then (bm.${opponent}->>'id')::integer end`);

  const rows = await ex.execute<{
    event: StatsEventRow | null;
    stage_type: string | null;
    entries: StatsEntryRow[];
    teams: StatsTeamRow[];
    matches: StatsMatchRow[];
    frames: StatsFrameAgg[];
    zone_distances: { zone: number; distance_ft: number }[];
    parent: StatsLinkedEvent | null;
    children: StatsLinkedEvent[];
  }>(sql`
    select
      (
        select json_build_object(
          'id', e.id, 'league_id', e.league_id, 'league_name', l.name, 'event_date', e.event_date,
          'created_at', e.created_at, 'location', e.location, 'status', e.status,
          'bonus_point_enabled', e.bonus_point_enabled, 'bracket_frame_count', e.bracket_frame_count,
          'team_size', e.team_size, 'handicap_enabled', e.handicap_enabled,
          'putt_distance_ft', e.putt_distance_ft, 'putt_counts_reliable', e.putt_counts_reliable,
          'parent_event_id', e.parent_event_id, 'link_type', e.link_type,
          'bracket_format', e.bracket_format, 'double_grand_final', e.double_grand_final,
          'qualification_round_enabled', e.qualification_round_enabled
        )
        from ${events} e join ${leagues} l on l.id = e.league_id
        where e.id = ${eventId}
      ) as event,
      (
        select bs.type from ${bracket_stage} bs where bs.tournament_id = ${eventId}
        order by bs.number limit 1
      ) as stage_type,
      coalesce((
        select json_agg(json_build_object(
          'id', ep.id, 'player_id', ep.player_id, 'player_number', p.player_number,
          'full_name', p.full_name, 'zone', ep.zone, 'putt_distance_ft', ep.putt_distance_ft,
          'team_id', coalesce(tm.team_id, sub.team_id), 'slot', coalesce(tm.slot, sub.slot)
        ) order by p.full_name, ep.id)
        from ${event_players} ep
        join ${players} p on p.id = ep.player_id
        left join lateral (
          select m.team_id, m.slot from ${team_members} m where m.event_player_id = ep.id
          order by m.slot limit 1
        ) tm on true
        left join lateral (
          select s.team_id, s.slot from ${team_member_substitutions} s
          where s.out_event_player_id = ep.id and tm.team_id is null
          order by s.created_at desc limit 1
        ) sub on true
        where ep.event_id = ${eventId}
      ), '[]'::json) as entries,
      coalesce((
        select json_agg(json_build_object('id', t.id, 'seed', t.seed, 'placement', pl.placement) order by t.seed nulls last, t.id)
        from ${teams} t
        left join ${event_placements} pl on pl.team_id = t.id and pl.event_id = t.event_id
        where t.event_id = ${eventId}
      ), '[]'::json) as teams,
      coalesce((
        select json_agg(json_build_object(
          'id', bm.id, 'number', bm.number, 'status', bm.status,
          'opponent1', bm.opponent1, 'opponent2', bm.opponent2,
          'score_override_1', bm.score_override_1, 'score_override_2', bm.score_override_2,
          'group_id', bm.group_id, 'group_number', bg.number,
          'round_id', bm.round_id, 'round_number', br.number,
          'last_round_of_group', (select max(lr.number) from ${bracket_round} lr where lr.group_id = bm.group_id),
          'team1_id', p1.team_id, 'team2_id', p2.team_id, 'lane_label', ln.label,
          'frame_count', (select count(*) from ${frame_results} fr where fr.bracket_match_id = bm.id)
        ) order by bm.id)
        from ${bracket_match} bm
        join ${bracket_group} bg on bg.id = bm.group_id
        join ${bracket_round} br on br.id = bm.round_id
        left join ${bracket_participant} p1 on p1.id = ${participantId('opponent1')}
        left join ${bracket_participant} p2 on p2.id = ${participantId('opponent2')}
        left join ${lanes} ln on ln.id = bm.lane_id
        where bm.event_id = ${eventId}
      ), '[]'::json) as matches,
      coalesce((
        select json_agg(f) from (
          select fr.event_player_id as entry_id, fr.bracket_match_id as match_id, mf.is_overtime as overtime,
            zp.zone, fr.putt_distance_ft as distance_ft,
            count(*)::int as frames, sum(fr.putts_made)::int as made, sum(fr.points_earned)::int as points,
            count(*) filter (where fr.putts_made = 0)::int as made0,
            count(*) filter (where fr.putts_made = 1)::int as made1,
            count(*) filter (where fr.putts_made = 2)::int as made2,
            count(*) filter (where fr.putts_made = 3)::int as made3
          from ${frame_results} fr
          join ${match_frames} mf on mf.id = fr.match_frame_id
          join ${bracket_match} bm on bm.id = fr.bracket_match_id
          left join ${player_zone_periods} zp on zp.id = fr.zone_period_id
          where bm.event_id = ${eventId}
          group by fr.event_player_id, fr.bracket_match_id, mf.is_overtime, zp.zone, fr.putt_distance_ft
        ) f
      ), '[]'::json) as frames,
      coalesce((
        select json_agg(json_build_object('zone', z.zone, 'distance_ft', z.distance_ft) order by z.zone)
        from ${event_zone_distances} z where z.event_id = ${eventId}
      ), '[]'::json) as zone_distances,
      (
        select json_build_object('id', pe.id, 'status', pe.status, 'event_date', pe.event_date, 'link_type', null)
        from ${events} me join ${events} pe on pe.id = me.parent_event_id
        where me.id = ${eventId}
      ) as parent,
      coalesce((
        select json_agg(json_build_object('id', c.id, 'status', c.status, 'event_date', c.event_date, 'link_type', c.link_type) order by c.created_at, c.id)
        from ${events} c where c.parent_event_id = ${eventId}
      ), '[]'::json) as children
  `);

  const row = rows[0];
  if (!row?.event) return null;
  return {
    event: { ...row.event, putt_distance_ft: Number(row.event.putt_distance_ft) },
    stageType: row.stage_type,
    entries: row.entries.map((entry) => ({ ...entry, putt_distance_ft: Number(entry.putt_distance_ft) })),
    teams: row.teams,
    matches: row.matches.map((match) => ({ ...match, frame_count: Number(match.frame_count) })),
    frames: row.frames.map((frame) => ({ ...frame, distance_ft: Number(frame.distance_ft) })),
    zoneDistances: row.zone_distances.map((zone) => ({ zone: zone.zone, distance_ft: Number(zone.distance_ft) })),
    parent: row.parent,
    children: row.children,
  };
}

// ---------------------------------------------------------------------------
// Admin projections: never called on the public path.
// ---------------------------------------------------------------------------

export interface StatsEntryAdminRow {
  id: string;
  exclude_from_handicap: boolean;
  handicap_note: string | null;
  distance_override: boolean;
  qualification_frames: number;
  qualification_made: number;
  qualification_points: number;
}

export interface EventStatsAdminData {
  entries: StatsEntryAdminRow[];
  hasQualificationRound: boolean;
}

export async function getEventStatsAdminData(ex: Executor, eventId: string): Promise<EventStatsAdminData> {
  const rows = await ex.execute<{ entries: StatsEntryAdminRow[]; has_round: boolean }>(sql`
    select
      coalesce((
        select json_agg(json_build_object(
          'id', ep.id, 'exclude_from_handicap', ep.exclude_from_handicap,
          'handicap_note', ep.handicap_note, 'distance_override', ep.distance_override,
          'qualification_frames', coalesce(q.frames, 0), 'qualification_made', coalesce(q.made, 0),
          'qualification_points', coalesce(q.points, 0)
        ))
        from ${event_players} ep
        left join lateral (
          select count(*)::int as frames, sum(qf.putts_made)::int as made, sum(qf.points_earned)::int as points
          from ${qualification_frames} qf where qf.event_player_id = ep.id
        ) q on true
        where ep.event_id = ${eventId}
      ), '[]'::json) as entries,
      exists (select 1 from ${qualification_rounds} qr where qr.event_id = ${eventId}) as has_round
  `);
  const row = rows[0];
  return { entries: row?.entries ?? [], hasQualificationRound: Boolean(row?.has_round) };
}

// ---------------------------------------------------------------------------
// League history (season context and admin analytics)
// ---------------------------------------------------------------------------

/**
 * "Earlier completed events of the same league": ordered by (event_date, created_at,
 * id), as handicap stats order same-night events, so a second chance sees its parent.
 * Completed events are always publicly visible (mirrors isEventPubliclyVisible).
 */
function earlierCompletedEvents(event: Pick<StatsEventRow, 'id' | 'league_id' | 'event_date' | 'created_at'>) {
  return sql`e.league_id = ${event.league_id} and e.status = 'completed'
    and (e.event_date, e.created_at, e.id) < (${event.event_date}::date, ${event.created_at}::timestamptz, ${event.id}::uuid)`;
}

export interface SeasonCountsRow {
  player_id: string;
  zone: number | null;
  distance_ft: number;
  /** The zone's event distance in that earlier event, when it had one. */
  nominal_ft: number | null;
  reliable: boolean;
  frames: number;
  made: number;
  points: number;
}

/**
 * Per player, frames in earlier completed league events, grouped by the frame's zone,
 * distance, that zone's event distance and the event's putt-count reliability.
 */
export async function getSeasonCounts(
  ex: Executor,
  event: Pick<StatsEventRow, 'id' | 'league_id' | 'event_date' | 'created_at'>,
  playerIds: readonly string[]
): Promise<SeasonCountsRow[]> {
  if (playerIds.length === 0) return [];
  const ids = sql.join([...new Set(playerIds)].map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await ex.execute<SeasonCountsRow & Record<string, unknown>>(sql`
    select ep.player_id, zp.zone, fr.putt_distance_ft as distance_ft, ezd.distance_ft as nominal_ft,
      e.putt_counts_reliable as reliable,
      count(*)::int as frames, sum(fr.putts_made)::int as made, sum(fr.points_earned)::int as points
    from ${frame_results} fr
    join ${event_players} ep on ep.id = fr.event_player_id
    join ${events} e on e.id = ep.event_id
    left join ${player_zone_periods} zp on zp.id = fr.zone_period_id
    left join ${event_zone_distances} ezd on ezd.event_id = e.id and ezd.zone = zp.zone
    where ep.player_id in (${ids}) and ${earlierCompletedEvents(event)}
    group by ep.player_id, zp.zone, fr.putt_distance_ft, ezd.distance_ft, e.putt_counts_reliable
  `);
  return rows.map((row) => ({
    ...row,
    distance_ft: Number(row.distance_ft),
    nominal_ft: row.nominal_ft === null ? null : Number(row.nominal_ft),
    frames: Number(row.frames),
    made: Number(row.made),
    points: Number(row.points),
  }));
}

export interface FieldSeasonRow {
  reliable: boolean;
  frames: number;
  made: number;
  points: number;
  frames_per_match: number;
}

/** The whole field's frames in earlier completed league events, per event reliability and frame count. */
export async function getFieldSeasonCounts(
  ex: Executor,
  event: Pick<StatsEventRow, 'id' | 'league_id' | 'event_date' | 'created_at'>
): Promise<FieldSeasonRow[]> {
  const rows = await ex.execute<FieldSeasonRow & Record<string, unknown>>(sql`
    select e.putt_counts_reliable as reliable, e.bracket_frame_count as frames_per_match,
      count(*)::int as frames, sum(fr.putts_made)::int as made, sum(fr.points_earned)::int as points
    from ${frame_results} fr
    join ${event_players} ep on ep.id = fr.event_player_id
    join ${events} e on e.id = ep.event_id
    where ${earlierCompletedEvents(event)}
    group by e.putt_counts_reliable, e.bracket_frame_count
  `);
  return rows.map((row) => ({
    reliable: row.reliable,
    frames_per_match: Number(row.frames_per_match),
    frames: Number(row.frames),
    made: Number(row.made),
    points: Number(row.points),
  }));
}

export interface HistoryEntryRow {
  event_id: string;
  entry_id: string;
  team_id: string | null;
  /** Team slot; a substitute shares the slot of the player they replaced. */
  slot: number | null;
  frames_per_match: number;
  frames: number;
  points: number;
}

/**
 * Per entry and team, bracket frames in earlier completed league events of the same
 * type (handicap or not), for the league range of the spread statistics.
 */
export async function getLeagueHistoryEntries(
  ex: Executor,
  event: Pick<StatsEventRow, 'id' | 'league_id' | 'event_date' | 'created_at' | 'handicap_enabled'>
): Promise<HistoryEntryRow[]> {
  const rows = await ex.execute<HistoryEntryRow & Record<string, unknown>>(sql`
    select e.id as event_id, ep.id as entry_id, coalesce(tm.team_id, sub.team_id) as team_id,
      coalesce(tm.slot, sub.slot) as slot, e.bracket_frame_count as frames_per_match,
      count(fr.id)::int as frames, coalesce(sum(fr.points_earned), 0)::int as points
    from ${event_players} ep
    join ${events} e on e.id = ep.event_id
    left join lateral (
      select m.team_id, m.slot from ${team_members} m where m.event_player_id = ep.id order by m.slot limit 1
    ) tm on true
    left join lateral (
      select s.team_id, s.slot from ${team_member_substitutions} s
      where s.out_event_player_id = ep.id and tm.team_id is null
      order by s.created_at desc limit 1
    ) sub on true
    left join ${frame_results} fr on fr.event_player_id = ep.id and fr.bracket_match_id is not null
    where ${earlierCompletedEvents(event)} and e.handicap_enabled = ${event.handicap_enabled}
    group by e.id, ep.id, tm.team_id, tm.slot, sub.team_id, sub.slot
  `);
  return rows.map((row) => ({
    ...row,
    frames_per_match: Number(row.frames_per_match),
    frames: Number(row.frames),
    points: Number(row.points),
  }));
}
