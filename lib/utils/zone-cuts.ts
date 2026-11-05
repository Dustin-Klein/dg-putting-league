import type { ZoneDefinition } from '@/lib/types/handicap';

/**
 * Starting zones from cut lines on past scoring. Scores are points per 5-frame match.
 * `cuts[i]` is the boundary between `zones[i]` and `zones[i + 1]`, ascending. Pure and
 * client-safe: the card and its tests share these rules.
 */

export const SCORE_MAX = 20;
export const CUT_STEP = 0.1;

export interface SeedScore {
  eligible: boolean;
  history: { points_per_match: number };
}

export type ZoneSource = 'cut' | 'override' | 'insufficient';

export interface StartingZone {
  player_id: string;
  zone: number;
  source: ZoneSource;
}

export interface HistogramBin<T> {
  from: number;
  to: number;
  eligible: T[];
  ineligible: T[];
}

export interface BinPart {
  zone: number;
  count: number;
  from: number;
  to: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Cuts next to the default zone open half a zone's effect either side of the field's
 * median, where a player on a cut ends up equally far from the median in either zone.
 * Cuts further out sit at the ends of the scale, so nobody starts more than one zone away.
 */
export function defaultCuts(
  candidates: readonly SeedScore[],
  zones: readonly ZoneDefinition[],
  defaultZone: number,
  zoneEffect: number
): number[] {
  const scores = candidates.filter((candidate) => candidate.eligible).map((candidate) => candidate.history.points_per_match);
  if (scores.length === 0) return [];
  const center = median(scores);
  const start = zones.findIndex((zone) => zone.zone === defaultZone);
  return zones.slice(1).map((_, i) => {
    if (i === start - 1) return Math.min(SCORE_MAX, Math.max(0, round1(center - zoneEffect / 2)));
    if (i === start) return Math.min(SCORE_MAX, Math.max(0, round1(center + zoneEffect / 2)));
    return i < start ? 0 : SCORE_MAX;
  });
}

/** Strict comparisons, as in decideZoneChange: a score exactly on a cut stays nearer the default. */
export function zoneForScore(
  score: number,
  cuts: readonly number[],
  zones: readonly ZoneDefinition[],
  defaultZone: number
): number {
  const start = zones.findIndex((zone) => zone.zone === defaultZone);
  let index = start;
  while (index < zones.length - 1 && score > cuts[index]) index += 1;
  if (index === start) {
    while (index > 0 && score < cuts[index - 1]) index -= 1;
  }
  return zones[index].zone;
}

export function assignStartingZones<T extends SeedScore & { player_id: string }>(
  candidates: readonly T[],
  cuts: readonly number[],
  zones: readonly ZoneDefinition[],
  defaultZone: number,
  overrides: Readonly<Record<string, number>>
): StartingZone[] {
  return candidates.map((candidate) => {
    const override = overrides[candidate.player_id];
    if (override !== undefined) return { player_id: candidate.player_id, zone: override, source: 'override' };
    if (!candidate.eligible) return { player_id: candidate.player_id, zone: defaultZone, source: 'insufficient' };
    return {
      player_id: candidate.player_id,
      zone: zoneForScore(candidate.history.points_per_match, cuts, zones, defaultZone),
      source: 'cut',
    };
  });
}

/** A score putted from `fromZone`, as it should read from `toZone`. Farther zones score lower. */
export function expectedScore(score: number, fromZone: number, toZone: number, zoneEffect: number): number {
  return Math.min(SCORE_MAX, Math.max(0, score + (fromZone - toZone) * zoneEffect));
}

/** Histogram rows from 0 to SCORE_MAX; a perfect score lands in the last bin. */
export function binCandidates<T extends SeedScore>(candidates: readonly T[], width = 1): Array<HistogramBin<T>> {
  const count = Math.ceil(SCORE_MAX / width);
  const bins: Array<HistogramBin<T>> = Array.from({ length: count }, (_, i) => ({
    from: i * width,
    to: (i + 1) * width,
    eligible: [],
    ineligible: [],
  }));
  for (const candidate of candidates) {
    const index = Math.min(count - 1, Math.floor(candidate.history.points_per_match / width));
    bins[index][candidate.eligible ? 'eligible' : 'ineligible'].push(candidate);
  }
  return bins;
}

/**
 * A bin's eligible players as one part per zone, each spanning the part of the bin that
 * zone covers. A part can be empty-width: a score exactly on a cut at the bin's edge.
 */
export function splitBin<T extends SeedScore>(
  bin: HistogramBin<T>,
  cuts: readonly number[],
  zones: readonly ZoneDefinition[],
  defaultZone: number
): BinPart[] {
  const parts = new Map<number, number>();
  for (const candidate of bin.eligible) {
    const zone = zoneForScore(candidate.history.points_per_match, cuts, zones, defaultZone);
    parts.set(zone, (parts.get(zone) ?? 0) + 1);
  }
  return [...parts.entries()].sort(([a], [b]) => a - b).map(([zone, count]) => {
    const index = zones.findIndex((definition) => definition.zone === zone);
    const low = index > 0 ? cuts[index - 1] : 0;
    const high = index < cuts.length ? cuts[index] : SCORE_MAX;
    const from = Math.min(bin.to, Math.max(bin.from, low));
    return { zone, count, from, to: Math.max(from, Math.min(bin.to, high)) };
  });
}

/**
 * Keep cuts on the 0.1 grid, inside the scale and strictly ascending. `moved` is the
 * cut being dragged: it stops at its neighbours instead of pushing them along.
 */
export function clampCuts(cuts: readonly number[], moved?: number): number[] {
  const next = cuts.map((cut) => Math.min(SCORE_MAX, Math.max(0, round1(cut))));
  if (moved !== undefined) {
    const low = moved > 0 ? round1(next[moved - 1] + CUT_STEP) : 0;
    const high = moved < next.length - 1 ? round1(next[moved + 1] - CUT_STEP) : SCORE_MAX;
    if (low <= high) next[moved] = Math.min(high, Math.max(low, next[moved]));
  }
  for (let i = 1; i < next.length; i++) {
    if (next[i] <= next[i - 1]) next[i] = round1(next[i - 1] + CUT_STEP);
  }
  for (let i = next.length - 1; i >= 0; i--) {
    const ceiling = round1(SCORE_MAX - (next.length - 1 - i) * CUT_STEP);
    if (next[i] > ceiling) next[i] = ceiling;
    if (i < next.length - 1 && next[i] >= next[i + 1]) next[i] = round1(next[i + 1] - CUT_STEP);
  }
  return next;
}
