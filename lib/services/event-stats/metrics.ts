/**
 * Event-stats metric vocabulary. Pure functions over raw counts: nothing is rounded
 * here, so player, team, zone and field totals reconcile; the UI rounds for display.
 *
 * - frame: one frame_results row (3 putts); overtime frames count.
 * - make %: Σ putts made ÷ (3 × Σ frames), never an average of percentages; the bonus
 *   point never enters it.
 * - PPF: Σ points ÷ Σ frames.
 * - points per match: PPF × this event's frames per match (normalizedPoints).
 */

export const PUTTS_PER_FRAME = 3;
/** Below this many frames a row is a small sample: dimmed and never in a "best" callout. */
export const SMALL_SAMPLE_FRAMES = 10;
/** A canonical margin of at most this many points is a close match. */
export const CLOSE_MATCH_MARGIN = 2;

export interface FrameCounts {
  frames: number;
  made: number;
  points: number;
  /** Frames with all 3 putts made. */
  threes: number;
  /** Frames by putts made: [0, 1, 2, 3]. */
  mix: [number, number, number, number];
}

export function emptyCounts(): FrameCounts {
  return { frames: 0, made: 0, points: 0, threes: 0, mix: [0, 0, 0, 0] };
}

export function addCounts(target: FrameCounts, source: FrameCounts): FrameCounts {
  target.frames += source.frames;
  target.made += source.made;
  target.points += source.points;
  target.threes += source.threes;
  for (let i = 0; i < 4; i++) target.mix[i] += source.mix[i];
  return target;
}

export function sumCounts(items: Iterable<FrameCounts>): FrameCounts {
  const total = emptyCounts();
  for (const item of items) addCounts(total, item);
  return total;
}

/** Fraction 0–1, or null when nothing was attempted. */
export function makeRate(made: number, frames: number): number | null {
  return frames > 0 ? made / (PUTTS_PER_FRAME * frames) : null;
}

export function pointsPerFrame(points: number, frames: number): number | null {
  return frames > 0 ? points / frames : null;
}

/** points ÷ frames × targetFrames: the shared normalization primitive. */
export function normalizedPoints(points: number, frames: number, targetFrames: number): number | null {
  return frames > 0 ? (points / frames) * targetFrames : null;
}

export function isSmallSample(frames: number): boolean {
  return frames < SMALL_SAMPLE_FRAMES;
}

/**
 * A team's points per match: each member's normalized points, summed. A member with
 * no frames contributes 0 (and is flagged in the admin view).
 */
export function teamPointsPerMatch(
  members: readonly Pick<FrameCounts, 'points' | 'frames'>[],
  framesPerMatch: number
): number | null {
  if (!members.some((member) => member.frames > 0)) return null;
  return members.reduce((sum, member) => sum + (normalizedPoints(member.points, member.frames, framesPerMatch) ?? 0), 0);
}

/** One player's regulation frames in one played match. */
export interface PlayerMatchLine {
  matchId: number;
  /** For "earlier match" tiebreaks: bracket order (group, round, number). */
  order: number;
  regulationFrames: number;
  regulationPoints: number;
  regulationMade: number;
}

/**
 * Best match: the most regulation-frame points in one played match with a full set of
 * regulation frames. Ties: higher make % in that match, then the earlier match.
 */
export function bestMatch(lines: readonly PlayerMatchLine[], framesPerMatch: number): PlayerMatchLine | null {
  let best: PlayerMatchLine | null = null;
  for (const line of lines) {
    if (line.regulationFrames < framesPerMatch) continue;
    if (
      !best ||
      line.regulationPoints > best.regulationPoints ||
      (line.regulationPoints === best.regulationPoints &&
        (line.regulationMade / line.regulationFrames > best.regulationMade / best.regulationFrames ||
          (line.regulationMade / line.regulationFrames === best.regulationMade / best.regulationFrames &&
            line.order < best.order)))
    ) {
      best = line;
    }
  }
  return best;
}

export function margin(score1: number, score2: number): number {
  return Math.abs(score1 - score2);
}

export function isCloseMatch(score1: number, score2: number): boolean {
  return margin(score1, score2) <= CLOSE_MATCH_MARGIN;
}

/** Counts per margin from 0 to the largest margin seen (every bucket present). */
export function marginHistogram(margins: readonly number[]): { margin: number; count: number }[] {
  if (margins.length === 0) return [];
  const max = Math.max(...margins);
  const counts = Array.from({ length: max + 1 }, (_, value) => ({ margin: value, count: 0 }));
  for (const value of margins) counts[value].count++;
  return counts;
}

/** Population standard deviation; null for fewer than two values. */
export function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** 1-based ranks, ties sharing their average rank. Higher value → rank 1 when `descending`. */
export function averageRanks(values: readonly number[], descending = false): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (descending ? b.value - a.value : a.value - b.value));
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].index] = rank;
    i = j + 1;
  }
  return ranks;
}

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Spearman rank correlation with average ranks for ties; null below 3 pairs or with no variation. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  return pearson(averageRanks(xs), averageRanks(ys));
}
