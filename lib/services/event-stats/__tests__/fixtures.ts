import { Status } from 'brackets-model';
import type {
  EventStatsSnapshot,
  StatsEntryRow,
  StatsEventRow,
  StatsFrameAgg,
  StatsMatchRow,
} from '@/lib/repositories/event-stats-repository.db';

export function eventRow(overrides: Partial<StatsEventRow> = {}): StatsEventRow {
  return {
    id: 'event-1',
    league_id: 'league-1',
    league_name: 'Thursday Night',
    event_date: '2026-11-20',
    created_at: '2026-11-01T00:00:00.000Z',
    location: 'Venue',
    status: 'bracket',
    bonus_point_enabled: true,
    bracket_frame_count: 5,
    team_size: 2,
    handicap_enabled: false,
    putt_distance_ft: 25,
    putt_counts_reliable: true,
    parent_event_id: null,
    link_type: null,
    bracket_format: 'double_elimination',
    double_grand_final: true,
    qualification_round_enabled: false,
    ...overrides,
  };
}

export function entry(id: string, team: string | null, overrides: Partial<StatsEntryRow> = {}): StatsEntryRow {
  return {
    id,
    player_id: `player-${id}`,
    player_number: Number(id.replace(/\D/g, '')) || 1,
    full_name: `Player ${id}`,
    zone: null,
    putt_distance_ft: 25,
    team_id: team,
    slot: 1,
    ...overrides,
  };
}

let nextMatchId = 1;

export function match(team1: string | null, team2: string | null, overrides: Partial<StatsMatchRow> = {}): StatsMatchRow {
  const id = overrides.id ?? nextMatchId++;
  const winner = overrides.status === Status.Completed || overrides.status === Status.Archived;
  return {
    id,
    number: id,
    status: Status.Completed,
    opponent1: team1 === null ? null : { id: 100 + id * 2, ...(winner ? {} : {}) },
    opponent2: team2 === null ? null : { id: 101 + id * 2 },
    score_override_1: null,
    score_override_2: null,
    group_id: 1,
    group_number: 1,
    round_id: 1,
    round_number: 1,
    last_round_of_group: 3,
    team1_id: team1,
    team2_id: team2,
    lane_label: null,
    frame_count: 0,
    ...overrides,
  };
}

/** A completed match with scores and a result, team1 winning unless the scores say otherwise. */
export function completed(team1: string, team2: string, score1: number, score2: number, overrides: Partial<StatsMatchRow> = {}): StatsMatchRow {
  const m = match(team1, team2, overrides);
  return {
    ...m,
    status: overrides.status ?? Status.Completed,
    opponent1: { id: 100 + m.id * 2, score: score1, result: score1 > score2 ? 'win' : 'loss' },
    opponent2: { id: 101 + m.id * 2, score: score2, result: score1 > score2 ? 'loss' : 'win' },
  };
}

/** `frames` frames for one entry in one match, every frame with `made` putts. */
export function frames(
  entryId: string,
  matchId: number,
  count: number,
  made: number,
  opts: { overtime?: boolean; bonus?: boolean; zone?: number | null; distance?: number } = {}
): StatsFrameAgg {
  const points = made === 3 && (opts.bonus ?? true) ? 4 : made;
  return {
    entry_id: entryId,
    match_id: matchId,
    overtime: opts.overtime ?? false,
    zone: opts.zone ?? null,
    distance_ft: opts.distance ?? 25,
    frames: count,
    made: made * count,
    points: points * count,
    made0: made === 0 ? count : 0,
    made1: made === 1 ? count : 0,
    made2: made === 2 ? count : 0,
    made3: made === 3 ? count : 0,
  };
}

export function snapshot(parts: Partial<EventStatsSnapshot> & { matches: StatsMatchRow[] }): EventStatsSnapshot {
  const frameAggs = parts.frames ?? [];
  const counts = new Map<number, number>();
  for (const f of frameAggs) counts.set(f.match_id, (counts.get(f.match_id) ?? 0) + f.frames);
  return {
    event: parts.event ?? eventRow(),
    stageType: 'double_elimination',
    entries: parts.entries ?? [],
    teams: parts.teams ?? [],
    matches: parts.matches.map((m) => ({ ...m, frame_count: m.frame_count || counts.get(m.id) || 0 })),
    frames: frameAggs,
    zoneDistances: parts.zoneDistances ?? [],
    parent: parts.parent ?? null,
    children: parts.children ?? [],
  };
}
