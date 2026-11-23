import {
  averageRanks,
  bestMatch,
  isCloseMatch,
  makeRate,
  marginHistogram,
  normalizedPoints,
  spearman,
  standardDeviation,
  sumCounts,
  teamPointsPerMatch,
} from '../metrics';

describe('event-stats metrics', () => {
  it('computes make % from summed counts, never an average of percentages', () => {
    const total = sumCounts([
      { frames: 1, made: 3, points: 4, threes: 1, mix: [0, 0, 0, 1] },
      { frames: 9, made: 9, points: 9, threes: 0, mix: [0, 9, 0, 0] },
    ]);
    expect(makeRate(total.made, total.frames)).toBeCloseTo(12 / 30);
    // The average of the two percentages would be (100% + 33.3%) / 2.
    expect(makeRate(total.made, total.frames)).not.toBeCloseTo((1 + 1 / 3) / 2);
    expect(makeRate(0, 0)).toBeNull();
  });

  it('normalizes points to the target frame count', () => {
    expect(normalizedPoints(22, 10, 5)).toBe(11);
    expect(normalizedPoints(22, 10, 7)).toBeCloseTo(15.4);
    expect(normalizedPoints(5, 0, 5)).toBeNull();
  });

  it('sums members for team points per match, a zero-frame member adding 0', () => {
    expect(teamPointsPerMatch([{ points: 20, frames: 10 }, { points: 9, frames: 5 }], 5)).toBe(19);
    expect(teamPointsPerMatch([{ points: 20, frames: 10 }, { points: 0, frames: 0 }], 5)).toBe(10);
    expect(teamPointsPerMatch([{ points: 0, frames: 0 }], 5)).toBeNull();
    expect(teamPointsPerMatch([{ points: 6, frames: 3 }, { points: 6, frames: 3 }, { points: 3, frames: 3 }], 3)).toBe(15);
  });

  it('picks the best match by regulation points, needing a full set of frames', () => {
    const line = (matchId: number, order: number, frames: number, points: number, made: number) =>
      ({ matchId, order, regulationFrames: frames, regulationPoints: points, regulationMade: made });
    expect(bestMatch([line(1, 1, 4, 16, 12), line(2, 2, 5, 12, 10)], 5)?.matchId).toBe(2);
    expect(bestMatch([line(1, 1, 5, 12, 9), line(2, 2, 5, 12, 10)], 5)?.matchId).toBe(2);
    expect(bestMatch([line(1, 3, 5, 12, 10), line(2, 2, 5, 12, 10)], 5)?.matchId).toBe(2);
    expect(bestMatch([line(1, 1, 3, 12, 9)], 5)).toBeNull();
  });

  it('counts margins in buckets and marks close matches', () => {
    expect(marginHistogram([1, 3, 1])).toEqual([
      { margin: 0, count: 0 }, { margin: 1, count: 2 }, { margin: 2, count: 0 }, { margin: 3, count: 1 },
    ]);
    expect(marginHistogram([])).toEqual([]);
    expect(isCloseMatch(20, 18)).toBe(true);
    expect(isCloseMatch(20, 17)).toBe(false);
  });

  it('ranks with averaged ties and computes Spearman', () => {
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('computes a population standard deviation', () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(standardDeviation([3])).toBeNull();
  });
});
