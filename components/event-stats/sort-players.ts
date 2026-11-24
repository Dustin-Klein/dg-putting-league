import type { PlayerRow } from '@/lib/types/event-stats';

export type SortKey = 'zone' | 'name' | 'make' | 'ppm' | 'frames' | 'matches' | 'threes' | 'best' | 'season';

export type SortDir = 'asc' | 'desc';

export const defaultDir = (key: SortKey): SortDir => (key === 'name' || key === 'zone' ? 'asc' : 'desc');

/** Nulls sort last in either direction. */
function compareNullable(a: number | null, b: number | null, dir: SortDir = 'desc'): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

export function sortPlayers(players: readonly PlayerRow[], key: SortKey, dir: SortDir, defaultWithinZone: 'name' | 'make'): PlayerRow[] {
  const byName = (a: PlayerRow, b: PlayerRow) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const byMake = (a: PlayerRow, b: PlayerRow) => compareNullable(a.line.make_rate, b.line.make_rate) || byName(a, b);
  const value: Record<Exclude<SortKey, 'name' | 'zone'>, (p: PlayerRow) => number | null> = {
    make: (p) => p.line.make_rate,
    ppm: (p) => p.line.points_per_match,
    frames: (p) => p.line.frames,
    matches: (p) => p.matches,
    threes: (p) => p.line.threes,
    best: (p) => p.best_match,
    season: (p) => p.season?.make_rate ?? null,
  };
  const cmp = (a: PlayerRow, b: PlayerRow): number => {
    if (key === 'name') return dir === 'asc' ? byName(a, b) : byName(b, a);
    if (key === 'zone') {
      return compareNullable(a.zone, b.zone, dir) || compareNullable(a.distance_ft, b.distance_ft, dir)
        || (defaultWithinZone === 'make' ? byMake(a, b) : byName(a, b));
    }
    return compareNullable(value[key](a), value[key](b), dir) || byName(a, b);
  };
  return [...players].sort(cmp);
}
