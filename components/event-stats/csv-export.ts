import { toCsv, type CsvCell } from '@/lib/utils/csv';
import type { AdminEventStats, StatLine } from '@/lib/types/event-stats';

const round = (value: number | null, digits: number): CsvCell =>
  value === null ? null : Number(value.toFixed(digits));

function lineCells(line: StatLine): CsvCell[] {
  return [
    line.frames,
    line.made,
    line.points,
    line.threes,
    round(line.make_rate === null ? null : line.make_rate * 100, 2),
    round(line.points_per_match, 2),
  ];
}

const LINE_HEADERS = ['frames', 'putts_made', 'points', 'three_for_three', 'make_pct', 'points_per_match'];

export function buildPlayersCsv(stats: AdminEventStats): string {
  const flags = new Map<string, string[]>();
  for (const flag of stats.entry_flags) flags.set(flag.entry_id, [...(flags.get(flag.entry_id) ?? []), flag.flag]);
  return toCsv([
    ['player_number', 'name', 'zone', 'distance_ft', ...LINE_HEADERS, 'matches', 'best_match', 'season_label', 'season_frames', 'season_make_pct', 'season_points_per_match', 'flags'],
    ...stats.players.map((p) => [
      p.player_number,
      p.name,
      p.zone,
      p.distance_ft,
      ...lineCells(p.line),
      p.matches,
      p.best_match,
      p.season?.label,
      p.season?.frames,
      round(p.season?.make_rate == null ? null : p.season.make_rate * 100, 2),
      round(p.season?.points_per_match ?? null, 2),
      (flags.get(p.entry_id) ?? []).join(' '),
    ]),
  ]);
}

export function buildTeamsCsv(stats: AdminEventStats): string {
  return toCsv([
    ['seed', 'placement', 'members', 'wins', 'losses', ...LINE_HEADERS, 'zero_frame_members'],
    ...stats.teams.map((t) => [
      t.seed,
      t.placement,
      t.members.map((m) => m.name).join(' & '),
      t.wins,
      t.losses,
      ...lineCells(t.line),
      t.zero_frame_members.join('; '),
    ]),
  ]);
}
