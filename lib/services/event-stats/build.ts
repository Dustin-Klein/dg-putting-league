/**
 * Builds event stats from one snapshot of raw rows. Pure. Official results (W–L,
 * margins, standings) come from canonical match scores; frame performance (make %,
 * points per match, putts mix) from frames only, so a manual override is never
 * attributed to players.
 */
import { eliminatedTeamIds } from '@/lib/brackets/elimination';
import { DOUBLE_ELIM_GRAND_FINAL_GROUP } from '@/lib/brackets/format';
import { buildMatchNumbers } from '@/lib/brackets/match-numbering';
import { isScheduledMatch, playedMatchState, type PlayedMatchState } from '@/lib/brackets/match-state';
import type { DecidedMatch } from '@/lib/brackets/placements';
import type {
  EventStatsSnapshot,
  StatsEntryRow,
  StatsMatchRow,
} from '@/lib/repositories/event-stats-repository.db';
import type {
  AdminTeamRow,
  DataWarning,
  MatchFact,
  MatchesSection,
  PlayerRow,
  PublicEventStats,
  StandingRow,
  StatLine,
  StatsMember,
  ZoneGroup,
} from '@/lib/types/event-stats';
import { sideLabel } from './labels';
import {
  addCounts,
  bestMatch,
  emptyCounts,
  isCloseMatch,
  isSmallSample,
  makeRate,
  margin,
  marginHistogram,
  normalizedPoints,
  sumCounts,
  teamPointsPerMatch,
  type FrameCounts,
  type PlayerMatchLine,
} from './metrics';
import type { SeasonContext } from './season';

export interface EntryStats {
  entry: StatsEntryRow;
  counts: FrameCounts;
  /** (zone, distance) groups the entry's frames fall in. */
  groups: Set<string>;
  matchIds: Set<number>;
  matchLines: PlayerMatchLine[];
}

/** Everything the public and admin DTOs are cut from. Never sent as is. */
export interface EventStatsModel {
  report: Omit<PublicEventStats, 'parent' | 'child' | 'generated_at'>;
  entryStats: Map<string, EntryStats>;
  teams: AdminTeamRow[];
  warnings: DataWarning[];
}

interface OpponentJson {
  id?: number | null;
  score?: number;
  result?: string;
}

function opponent(value: unknown): OpponentJson | null {
  return value && typeof value === 'object' ? (value as OpponentJson) : null;
}

export function toStatLine(counts: FrameCounts, reliable: boolean, framesPerMatch: number): StatLine {
  return {
    frames: counts.frames,
    made: reliable ? counts.made : null,
    points: counts.points,
    threes: reliable ? counts.threes : null,
    make_rate: reliable ? makeRate(counts.made, counts.frames) : null,
    points_per_match: normalizedPoints(counts.points, counts.frames, framesPerMatch),
  };
}

function countsOf(frames: number, made: number, points: number, mix: [number, number, number, number]): FrameCounts {
  return { frames, made, points, threes: mix[3], mix };
}

interface MatchInfo {
  row: StatsMatchRow;
  state: PlayedMatchState | null;
  number: number | null;
  /** Frame points by team, all frames and regulation only. */
  points: Map<string, { all: number; regulation: number }>;
  hasOvertime: boolean;
  /** Entries with at least one frame in the match. */
  entriesWithFrames: Set<string>;
}

export function buildEventStats(snapshot: EventStatsSnapshot, season: SeasonContext | null): EventStatsModel {
  const { event } = snapshot;
  const reliable = event.putt_counts_reliable;
  const fpm = event.bracket_frame_count;
  const doubleElim = event.bracket_format === 'double_elimination';

  // --- Matches -----------------------------------------------------------------
  const groups = new Map<number, { id: number; number: number }>();
  const rounds = new Map<number, { id: number; group_id: number; number: number }>();
  for (const match of snapshot.matches) {
    groups.set(match.group_id, { id: match.group_id, number: match.group_number });
    rounds.set(match.round_id, { id: match.round_id, group_id: match.group_id, number: match.round_number });
  }
  const numbers = buildMatchNumbers([...groups.values()], [...rounds.values()], snapshot.matches);

  const matches = new Map<number, MatchInfo>();
  let total = 0;
  for (const row of snapshot.matches) {
    const isGrandFinalReset = doubleElim && row.group_number === DOUBLE_ELIM_GRAND_FINAL_GROUP && row.round_number === 2;
    if (isScheduledMatch(row, row.frame_count, { isGrandFinalReset })) total++;
    matches.set(row.id, {
      row,
      state: playedMatchState(row, row.frame_count),
      number: numbers.get(row.id) ?? null,
      points: new Map(),
      hasOvertime: false,
      entriesWithFrames: new Set(),
    });
  }

  // --- Frames → entries --------------------------------------------------------
  const entriesById = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  const entryStats = new Map<string, EntryStats>();
  const statsFor = (entry: StatsEntryRow): EntryStats => {
    let stats = entryStats.get(entry.id);
    if (!stats) {
      stats = { entry, counts: emptyCounts(), groups: new Set(), matchIds: new Set(), matchLines: [] };
      entryStats.set(entry.id, stats);
    }
    return stats;
  };
  const zoneDistance = new Map(snapshot.zoneDistances.map((zone) => [zone.zone, zone.distance_ft]));
  const groupCounts = new Map<string, { zone: number | null; distance: number; total: FrameCounts; byEntry: Map<string, FrameCounts> }>();

  for (const agg of snapshot.frames) {
    const match = matches.get(agg.match_id);
    const entry = entriesById.get(agg.entry_id);
    if (!match?.state || !entry) continue;
    const counts = countsOf(agg.frames, agg.made, agg.points, [agg.made0, agg.made1, agg.made2, agg.made3]);

    const stats = statsFor(entry);
    addCounts(stats.counts, counts);
    stats.matchIds.add(agg.match_id);
    if (!agg.overtime) {
      let line = stats.matchLines.find((l) => l.matchId === agg.match_id);
      if (!line) {
        line = { matchId: agg.match_id, order: match.number ?? agg.match_id, regulationFrames: 0, regulationPoints: 0, regulationMade: 0 };
        stats.matchLines.push(line);
      }
      line.regulationFrames += agg.frames;
      line.regulationPoints += agg.points;
      line.regulationMade += agg.made;
    }

    match.entriesWithFrames.add(entry.id);
    if (agg.overtime) match.hasOvertime = true;
    if (entry.team_id) {
      const teamPoints = match.points.get(entry.team_id) ?? { all: 0, regulation: 0 };
      teamPoints.all += agg.points;
      if (!agg.overtime) teamPoints.regulation += agg.points;
      match.points.set(entry.team_id, teamPoints);
    }

    const zone = event.handicap_enabled ? (agg.zone ?? entry.zone) : null;
    const key = `${zone ?? '-'}:${agg.distance_ft}`;
    stats.groups.add(key);
    const group = groupCounts.get(key) ?? { zone, distance: agg.distance_ft, total: emptyCounts(), byEntry: new Map() };
    addCounts(group.total, counts);
    group.byEntry.set(entry.id, addCounts(group.byEntry.get(entry.id) ?? emptyCounts(), counts));
    groupCounts.set(key, group);
  }

  // --- Teams and members -------------------------------------------------------
  const membersByTeam = new Map<string, StatsEntryRow[]>();
  for (const entry of snapshot.entries) {
    if (!entry.team_id) continue;
    const list = membersByTeam.get(entry.team_id) ?? [];
    list.push(entry);
    membersByTeam.set(entry.team_id, list);
  }
  for (const list of membersByTeam.values()) {
    list.sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99) || a.full_name.localeCompare(b.full_name));
  }
  const member = (entry: StatsEntryRow): StatsMember => ({ entry_id: entry.id, player_number: entry.player_number, name: entry.full_name });
  const teamName = (teamId: string | null) => sideLabel((teamId ? membersByTeam.get(teamId) ?? [] : []).map((e) => e.full_name));
  /** A team's entries by slot: a substitute and the player they replaced share one slot. */
  const slotsOf = (teamId: string): StatsEntryRow[][] => {
    const bySlot = new Map<number | string, StatsEntryRow[]>();
    for (const entry of membersByTeam.get(teamId) ?? []) {
      const key = entry.slot ?? entry.id;
      bySlot.set(key, [...(bySlot.get(key) ?? []), entry]);
    }
    return [...bySlot.values()];
  };

  // --- Official results --------------------------------------------------------
  const record = new Map<string, { wins: number; losses: number }>();
  const decided: DecidedMatch[] = [];
  const playing = new Map<string, string | null>();
  const warnings: DataWarning[] = [];
  const facts: { fact: MatchFact; regulation: [number, number]; margin: number }[] = [];
  const overtimeFacts: MatchFact[] = [];
  let completed = 0;
  let inProgress = 0;

  for (const match of [...matches.values()].sort((a, b) => (a.number ?? a.row.id) - (b.number ?? b.row.id))) {
    const { row, state } = match;
    const onLane = row.lane_label !== null && state !== 'completed';
    if (state === 'in_progress' || onLane) {
      for (const teamId of [row.team1_id, row.team2_id]) if (teamId) playing.set(teamId, row.lane_label);
    }
    if (!state) continue;
    const opp1 = opponent(row.opponent1);
    const opp2 = opponent(row.opponent2);
    const override = row.score_override_1 !== null && row.score_override_2 !== null;

    if (state === 'in_progress') {
      inProgress++;
      continue;
    }
    completed++;

    for (const [teamId, side] of [[row.team1_id, opp1], [row.team2_id, opp2]] as const) {
      if (!teamId) continue;
      const r = record.get(teamId) ?? { wins: 0, losses: 0 };
      if (side?.result === 'win') r.wins++;
      else if (side?.result === 'loss') r.losses++;
      record.set(teamId, r);
    }
    const team1Won = opp1?.result === 'win';
    const team2Won = opp2?.result === 'win';
    decided.push({
      id: row.id,
      groupNumber: row.group_number,
      roundNumber: row.round_number,
      isLastRoundOfGroup: row.round_number === row.last_round_of_group,
      winnerTeamId: team1Won ? row.team1_id ?? undefined : team2Won ? row.team2_id ?? undefined : undefined,
      loserTeamId: team1Won ? row.team2_id ?? undefined : team2Won ? row.team1_id ?? undefined : undefined,
      loserSlot: team1Won ? 'opponent2' : team2Won ? 'opponent1' : undefined,
    });

    const frames1 = row.team1_id ? match.points.get(row.team1_id) : undefined;
    const frames2 = row.team2_id ? match.points.get(row.team2_id) : undefined;
    if (override && row.frame_count === 0) {
      warnings.push({
        kind: 'manual_only',
        match_id: row.id,
        match_number: match.number,
        detail: `Score entered with no frames (${row.score_override_1}–${row.score_override_2}). Counts in W–L and margins; adds nothing to player stats.`,
      });
    } else if (override && ((frames1?.all ?? 0) !== row.score_override_1 || (frames2?.all ?? 0) !== row.score_override_2)) {
      warnings.push({
        kind: 'override_conflict',
        match_id: row.id,
        match_number: match.number,
        detail: `Official ${row.score_override_1}–${row.score_override_2}, frames sum to ${frames1?.all ?? 0}–${frames2?.all ?? 0}. Results use the official score; player stats use the frames.`,
      });
    }
    if (row.frame_count > 0) {
      const missing = [row.team1_id, row.team2_id]
        .flatMap((teamId) => (teamId ? slotsOf(teamId) : []))
        .filter((slot) => !slot.some((entry) => match.entriesWithFrames.has(entry.id)))
        .map((slot) => slot.map((entry) => entry.full_name).join(' / '));
      if (missing.length > 0) {
        warnings.push({
          kind: 'zero_frames',
          match_id: row.id,
          match_number: match.number,
          detail: `${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no frames in this match, so it isn't in their frame and match counts.`,
        });
      }
    }

    if (typeof opp1?.score === 'number' && typeof opp2?.score === 'number') {
      const fact: MatchFact = {
        match_id: row.id,
        number: match.number,
        side1: teamName(row.team1_id),
        side2: teamName(row.team2_id),
        score1: opp1.score,
        score2: opp2.score,
        overtime: match.hasOvertime,
      };
      const regulation: [number, number] = override
        ? [row.score_override_1 ?? 0, row.score_override_2 ?? 0]
        : [frames1?.regulation ?? 0, frames2?.regulation ?? 0];
      facts.push({ fact, regulation, margin: margin(opp1.score, opp2.score) });
      if (match.hasOvertime) overtimeFacts.push(fact);
    }
  }

  const eliminated = event.status === 'bracket'
    ? eliminatedTeamIds(event.bracket_format, event.double_grand_final, decided)
    : new Set<string>();

  // --- Players -----------------------------------------------------------------
  const players: PlayerRow[] = [];
  for (const entry of snapshot.entries) {
    const stats = entryStats.get(entry.id);
    if (!entry.team_id && !stats) continue;
    const counts = stats?.counts ?? emptyCounts();
    const small = isSmallSample(counts.frames);
    const best = stats ? bestMatch(stats.matchLines, fpm) : null;
    const moved = (stats?.groups.size ?? 0) > 1;
    players.push({
      entry_id: entry.id,
      player_number: entry.player_number,
      name: entry.full_name,
      zone: event.handicap_enabled ? entry.zone : null,
      distance_ft: entry.putt_distance_ft,
      team_id: entry.team_id,
      line: toStatLine(counts, reliable, fpm),
      matches: stats?.matchIds.size ?? 0,
      best_match: small || !best ? null : best.regulationPoints,
      small_sample: small,
      zone_moved: moved,
      season: moved ? null : season?.players.get(entry.player_id)?.line ?? null,
    });
  }
  players.sort((a, b) => (a.zone ?? 0) - (b.zone ?? 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));

  // --- Teams -------------------------------------------------------------------
  const teamRows: AdminTeamRow[] = [];
  const standings: StandingRow[] = [];
  for (const team of snapshot.teams) {
    const members = membersByTeam.get(team.id) ?? [];
    const memberCounts = members.map((entry) => entryStats.get(entry.id)?.counts ?? emptyCounts());
    const counts = sumCounts(memberCounts);
    const slots = slotsOf(team.id);
    const slotCounts = slots.map((slot) => sumCounts(slot.map((entry) => entryStats.get(entry.id)?.counts ?? emptyCounts())));
    const line: StatLine = {
      ...toStatLine(counts, reliable, fpm),
      points_per_match: teamPointsPerMatch(slotCounts, fpm),
    };
    const r = record.get(team.id) ?? { wins: 0, losses: 0 };
    const live = event.status === 'bracket';
    standings.push({
      team_id: team.id,
      seed: team.seed,
      placement: live ? null : team.placement,
      members: members.map(member),
      wins: r.wins,
      losses: r.losses,
      status: !live ? null : playing.has(team.id) ? 'playing' : eliminated.has(team.id) ? 'out' : 'in',
      lane: live ? playing.get(team.id) ?? null : null,
      line,
    });
    teamRows.push({
      team_id: team.id,
      seed: team.seed,
      placement: live ? null : team.placement,
      members: members.map((entry, i) => ({ ...member(entry), line: toStatLine(memberCounts[i], reliable, fpm) })),
      wins: r.wins,
      losses: r.losses,
      line,
      zero_frame_members: counts.frames > 0
        ? slots.filter((_, i) => slotCounts[i].frames === 0).flatMap((slot) => slot.map((entry) => entry.full_name))
        : [],
    });
  }
  const byStanding = (a: { placement: number | null; seed: number | null }, b: { placement: number | null; seed: number | null }) =>
    (a.placement ?? Infinity) - (b.placement ?? Infinity) || (a.seed ?? Infinity) - (b.seed ?? Infinity);
  standings.sort(byStanding);
  teamRows.sort(byStanding);

  for (const team of teamRows) {
    if (team.zero_frame_members.length > 0) {
      warnings.push({
        kind: 'zero_frames',
        match_id: null,
        match_number: null,
        detail: `${team.zero_frame_members.join(', ')} (${sideLabel(team.members.map((m) => m.name))}) ${team.zero_frame_members.length === 1 ? 'has' : 'have'} no frames this event; the team's points per match counts them as 0.`,
      });
    }
  }
  if (!reliable) {
    warnings.unshift({
      kind: 'unreliable_putts',
      match_id: null,
      match_number: null,
      detail: 'Imported scores: points only. Make %, putts mix and 3-for-3 are not shown for this event.',
    });
  }

  // --- Zones -------------------------------------------------------------------
  const zoneGroups: ZoneGroup[] = [...groupCounts.values()]
    .map((group) => {
      let best: ZoneGroup['best'] = null;
      if (reliable) {
        for (const [entryId, counts] of group.byEntry) {
          if (isSmallSample(counts.frames)) continue;
          const rate = makeRate(counts.made, counts.frames)!;
          const entry = entriesById.get(entryId)!;
          if (!best || rate > best.make_rate || (rate === best.make_rate && entry.full_name < best.name)) {
            best = { name: entry.full_name, player_number: entry.player_number, make_rate: rate };
          }
        }
      }
      const nominal = group.zone !== null ? zoneDistance.get(group.zone) : undefined;
      return {
        zone: group.zone,
        distance_ft: group.distance,
        off_nominal: nominal !== undefined && nominal !== group.distance,
        players: group.byEntry.size,
        line: toStatLine(group.total, reliable, fpm),
        mix: reliable ? group.total.mix : null,
        best,
      };
    })
    .sort((a, b) => (a.zone ?? 0) - (b.zone ?? 0) || Number(a.off_nominal) - Number(b.off_nominal) || a.distance_ft - b.distance_ft);

  const zones = event.handicap_enabled
    ? snapshot.zoneDistances.map((zone) => ({
        zone: zone.zone,
        distance_ft: zone.distance_ft,
        players: players.filter((p) => p.zone === zone.zone).length,
      })).filter((zone) => zone.players > 0)
    : [];

  // --- Match facts -------------------------------------------------------------
  const regulationTotal = (f: (typeof facts)[number]) => f.regulation[0] + f.regulation[1];
  const closest = facts.length === 0 ? null : facts.reduce((best, f) =>
    f.margin < best.margin || (f.margin === best.margin && regulationTotal(f) > regulationTotal(best)) ? f : best
  ).fact;
  const highest = facts.length === 0 ? null : facts.reduce((best, f) => (regulationTotal(f) > regulationTotal(best) ? f : best));
  const matchesSection: MatchesSection = {
    completed,
    margins: marginHistogram(facts.map((f) => f.margin)),
    closest,
    highest: highest ? { ...highest.fact, score1: highest.regulation[0], score2: highest.regulation[1] } : null,
    overtime: overtimeFacts,
  };

  const fieldCounts = sumCounts([...entryStats.values()].map((stats) => stats.counts));

  return {
    report: {
      event: {
        id: event.id,
        league_id: event.league_id,
        league_name: event.league_name,
        event_date: event.event_date,
        location: event.location,
        status: event.status === 'completed' ? 'completed' : 'bracket',
        bonus_point_enabled: event.bonus_point_enabled,
        frames_per_match: fpm,
        team_size: event.team_size,
        handicap_enabled: event.handicap_enabled,
        putt_distance_ft: event.putt_distance_ft,
        putt_counts_reliable: reliable,
        link_type: event.link_type,
      },
      progress: { completed, in_progress: inProgress, total },
      counts: { players: players.length, teams: snapshot.teams.length, matches: completed },
      zones,
      field: toStatLine(fieldCounts, reliable, fpm),
      close_matches: facts.filter((f) => isCloseMatch(f.fact.score1, f.fact.score2)).length,
      overtime_matches: overtimeFacts.length,
      season: season ? { field: season.field } : null,
      standings,
      players,
      zone_groups: zoneGroups,
      matches: matchesSection,
    },
    entryStats,
    teams: teamRows,
    warnings,
  };
}
