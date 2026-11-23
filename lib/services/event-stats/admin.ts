/**
 * Admin-only parts of the event report. Pure. Evaluation stats are the player's zone
 * window (possibly several events and qualification), never this event's performance.
 */
import type {
  EventStatsAdminData,
  EventStatsSnapshot,
  HistoryEntryRow,
} from '@/lib/repositories/event-stats-repository.db';
import type { EventEvaluationRow } from '@/lib/repositories/handicap-repository.db';
import type {
  AdminTeamRow,
  EntryFlag,
  EvaluationRow,
  EventAnalytics,
  QualificationRow,
  RangeStat,
} from '@/lib/types/event-stats';
import { sideLabel } from './labels';
import {
  isSmallSample,
  makeRate,
  pointsPerFrame,
  spearman,
  standardDeviation,
  teamPointsPerMatch,
} from './metrics';
import type { EntryStats } from './build';
import type { SeasonContext } from './season';

export function buildEntryFlags(snapshot: EventStatsSnapshot, admin: EventStatsAdminData): EntryFlag[] {
  const adminById = new Map(admin.entries.map((entry) => [entry.id, entry]));
  const zoneDistance = new Map(snapshot.zoneDistances.map((zone) => [zone.zone, zone.distance_ft]));
  const flags: EntryFlag[] = [];
  for (const entry of snapshot.entries) {
    const extra = adminById.get(entry.id);
    if (!extra) continue;
    const nominal = snapshot.event.handicap_enabled && entry.zone !== null ? zoneDistance.get(entry.zone) ?? null : null;
    const base = {
      entry_id: entry.id,
      name: entry.full_name,
      zone: snapshot.event.handicap_enabled ? entry.zone : null,
      zone_distance_ft: nominal,
      distance_ft: entry.putt_distance_ft,
    };
    if (extra.exclude_from_handicap) {
      flags.push({ ...base, flag: 'excluded', note: extra.handicap_note });
    }
    if (extra.distance_override) {
      flags.push({ ...base, flag: 'distance_override', note: extra.exclude_from_handicap ? null : extra.handicap_note });
    } else if (nominal !== null && nominal !== entry.putt_distance_ft) {
      flags.push({ ...base, flag: 'distance_mismatch', note: null });
    }
  }
  return flags.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.flag.localeCompare(b.flag));
}

export function buildQualification(
  snapshot: EventStatsSnapshot,
  admin: EventStatsAdminData
): QualificationRow[] | null {
  if (!admin.hasQualificationRound) return null;
  const reliable = snapshot.event.putt_counts_reliable;
  const names = new Map(snapshot.entries.map((entry) => [entry.id, entry.full_name]));
  return admin.entries
    .filter((entry) => entry.qualification_frames > 0)
    .map((entry) => ({
      entry_id: entry.id,
      name: names.get(entry.id) ?? '',
      frames: entry.qualification_frames,
      made: reliable ? entry.qualification_made : null,
      points: entry.qualification_points,
      make_rate: reliable ? makeRate(entry.qualification_made, entry.qualification_frames) : null,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function buildEvaluations(
  status: 'bracket' | 'completed',
  handicap: boolean,
  rows: readonly EventEvaluationRow[]
): { state: 'pending' | 'done' | 'none'; rows: EvaluationRow[] } {
  if (!handicap) return { state: 'none', rows: [] };
  if (status !== 'completed') return { state: 'pending', rows: [] };
  return {
    state: 'done',
    rows: rows.map((row) => ({
      player_id: row.player_id,
      name: row.player_name,
      zone: row.zone,
      new_zone: row.new_zone,
      decision: row.decision,
      eligible: row.eligible,
      applied: row.applied,
      skip_reason: row.skip_reason,
      resolution: row.resolution,
      window: {
        putts_made: row.stats.putts_made,
        putts_attempted: row.stats.putts_attempted,
        make_pct: row.stats.make_pct,
        matches: row.stats.matches,
        events: row.stats.events,
      },
    })),
  };
}

function range(values: readonly number[]): RangeStat | null {
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values), events: values.length };
}

/** The two spread statistics for one event's entries. */
function spreadOf(
  entries: readonly { teamId: string | null; slot: number | null; entryId: string; frames: number; points: number }[],
  framesPerMatch: number
): { playerSd: number | null; players: number; teamSd: number | null; teams: number } {
  const ppf = entries.filter((e) => !isSmallSample(e.frames)).map((e) => pointsPerFrame(e.points, e.frames)!);
  // One contribution per team slot: a substitute and the player they replaced share it.
  const byTeam = new Map<string, Map<number | string, { frames: number; points: number }>>();
  for (const entry of entries) {
    if (!entry.teamId) continue;
    const slots = byTeam.get(entry.teamId) ?? new Map();
    const key = entry.slot ?? entry.entryId;
    const slot = slots.get(key) ?? { frames: 0, points: 0 };
    slot.frames += entry.frames;
    slot.points += entry.points;
    slots.set(key, slot);
    byTeam.set(entry.teamId, slots);
  }
  const teamValues = [...byTeam.values()]
    .map((slots) => teamPointsPerMatch([...slots.values()], framesPerMatch))
    .filter((value): value is number => value !== null);
  return { playerSd: standardDeviation(ppf), players: ppf.length, teamSd: standardDeviation(teamValues), teams: teamValues.length };
}

export function buildAnalytics(input: {
  snapshot: EventStatsSnapshot;
  entryStats: Map<string, EntryStats>;
  teams: readonly AdminTeamRow[];
  season: SeasonContext | null;
  history: readonly HistoryEntryRow[];
}): EventAnalytics {
  const { snapshot, entryStats, teams, season, history } = input;
  const fpm = snapshot.event.bracket_frame_count;
  const reliable = snapshot.event.putt_counts_reliable;

  // Spread includes "don't count" entries: it describes the night, not the handicap decision.
  const current = spreadOf(
    snapshot.entries.map((entry) => {
      const counts = entryStats.get(entry.id)?.counts;
      return { teamId: entry.team_id, slot: entry.slot, entryId: entry.id, frames: counts?.frames ?? 0, points: counts?.points ?? 0 };
    }),
    fpm
  );
  const byEvent = new Map<string, HistoryEntryRow[]>();
  for (const row of history) {
    const list = byEvent.get(row.event_id) ?? [];
    list.push(row);
    byEvent.set(row.event_id, list);
  }
  const leaguePlayer: number[] = [];
  const leagueTeam: number[] = [];
  for (const rows of byEvent.values()) {
    const spread = spreadOf(
      rows.map((r) => ({ teamId: r.team_id, slot: r.slot, entryId: r.entry_id, frames: r.frames, points: r.points })),
      rows[0].frames_per_match
    );
    if (spread.playerSd !== null) leaguePlayer.push(spread.playerSd);
    if (spread.teamSd !== null) leagueTeam.push(spread.teamSd);
  }

  // Pre-event strength: members' season PPF summed (league to date, like with like).
  const completed = snapshot.event.status === 'completed';
  const playerByEntry = new Map(snapshot.entries.map((entry) => [entry.id, entry.player_id]));
  const strengthRows: EventAnalytics['strength']['rows'] = [];
  let withoutHistory = 0;
  if (completed && season) {
    for (const team of teams) {
      if (team.placement === null || team.members.length === 0) continue;
      let strength = 0;
      let missing = false;
      for (const m of team.members) {
        const counts = season.players.get(playerByEntry.get(m.entry_id) ?? '')?.counts;
        if (!counts || counts.frames === 0) {
          missing = true;
          break;
        }
        strength += counts.points / counts.frames;
      }
      if (missing) {
        withoutHistory++;
        continue;
      }
      strengthRows.push({ team_id: team.team_id, label: sideLabel(team.members.map((m) => m.name)), strength, placement: team.placement });
    }
  }
  // Negated placement: 1 means the strongest team on paper finished best.
  const rho = spearman(strengthRows.map((r) => r.strength), strengthRows.map((r) => -r.placement));

  const scatter: EventAnalytics['scatter'] = [];
  if (reliable && season) {
    for (const entry of snapshot.entries) {
      const counts = entryStats.get(entry.id)?.counts;
      const seasonCounts = season.players.get(entry.player_id)?.counts;
      if (!counts || isSmallSample(counts.frames) || !seasonCounts || isSmallSample(seasonCounts.reliableFrames)) continue;
      // Mixed-distance event frames aren't comparable with a one-zone season baseline.
      if ((entryStats.get(entry.id)?.groups.size ?? 0) > 1) continue;
      scatter.push({
        entry_id: entry.id,
        name: entry.full_name,
        zone: snapshot.event.handicap_enabled ? entry.zone : null,
        season_rate: makeRate(seasonCounts.reliableMade, seasonCounts.reliableFrames)!,
        event_rate: makeRate(counts.made, counts.frames)!,
      });
    }
  }

  return {
    spread: {
      player_ppf_sd: current.playerSd,
      players_counted: current.players,
      team_ppm_sd: current.teamSd,
      teams_counted: current.teams,
      league_player_ppf_sd: range(leaguePlayer),
      league_team_ppm_sd: range(leagueTeam),
    },
    strength: {
      available: completed,
      rho,
      teams_counted: strengthRows.length,
      teams_without_history: withoutHistory,
      rows: strengthRows.sort((a, b) => a.placement - b.placement),
    },
    scatter,
  };
}
