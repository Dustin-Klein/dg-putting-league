import {
  assignStartingZones,
  binCandidates,
  clampCuts,
  defaultCuts,
  expectedScore,
  splitBin,
  zoneForScore,
} from '../zone-cuts';

const ladder = (count: number) => Array.from({ length: count }, (_, i) => ({ zone: i + 1, distance_ft: 21 + i * 6 }));
const three = ladder(3);

function candidate(score: number, eligible = true, id = `p${score}`) {
  return { player_id: id, eligible, history: { points_per_match: score } };
}

describe('defaultCuts', () => {
  const field = [6, 8, 9, 11, 14].map((score) => candidate(score));

  it('opens either side of the median of eligible players', () => {
    expect(defaultCuts([...field, candidate(0, false), candidate(1, false)], three, 2, 3)).toEqual([7.5, 10.5]);
  });

  it('takes the midpoint of an even field and rounds to 0.1', () => {
    expect(defaultCuts([6, 7.33].map((score) => candidate(score)), three, 2, 3)).toEqual([5.2, 8.2]);
  });

  it('follows the zone effect', () => {
    expect(defaultCuts(field, three, 2, 2)).toEqual([8, 10]);
    expect(defaultCuts(field, three, 2, 4)).toEqual([7, 11]);
  });

  it('has one cut for two zones, on the side the default zone has a neighbour', () => {
    expect(defaultCuts(field, ladder(2), 1, 3)).toEqual([10.5]);
    expect(defaultCuts(field, ladder(2), 2, 3)).toEqual([7.5]);
  });

  it('parks cuts further out at the ends of the scale', () => {
    expect(defaultCuts(field, ladder(5), 3, 3)).toEqual([0, 7.5, 10.5, 20]);
  });

  it('handles a default zone at either end of a longer ladder', () => {
    expect(defaultCuts(field, three, 1, 3)).toEqual([10.5, 20]);
    expect(defaultCuts(field, three, 3, 3)).toEqual([0, 7.5]);
  });

  it('keeps a wide zone effect on the scale', () => {
    expect(defaultCuts([candidate(1)], three, 2, 6)).toEqual([0, 4]);
    expect(defaultCuts([candidate(19)], three, 2, 6)).toEqual([16, 20]);
  });

  it('has no cuts without an eligible player', () => {
    expect(defaultCuts([candidate(8, false)], three, 2, 3)).toEqual([]);
  });
});

describe('zoneForScore', () => {
  it('moves strictly past a cut; a score on a cut stays nearer the default', () => {
    const cuts = [7.3, 10.3];
    expect(zoneForScore(7.3, cuts, three, 2)).toBe(2);
    expect(zoneForScore(7.29, cuts, three, 2)).toBe(1);
    expect(zoneForScore(10.3, cuts, three, 2)).toBe(2);
    expect(zoneForScore(10.31, cuts, three, 2)).toBe(3);
  });

  it('handles the ends of the scale', () => {
    expect(zoneForScore(0, [7.3, 10.3], three, 2)).toBe(1);
    expect(zoneForScore(20, [7.3, 10.3], three, 2)).toBe(3);
  });

  it('keeps a player between default cuts on a longer ladder within one zone', () => {
    const cuts = [0, 7.5, 10.5, 20];
    const five = ladder(5);
    expect(zoneForScore(0, cuts, five, 3)).toBe(2);
    expect(zoneForScore(20, cuts, five, 3)).toBe(4);
  });

  it('walks several zones when the outer cuts are in play', () => {
    const cuts = [4, 7.5, 10.5, 14];
    const five = ladder(5);
    expect(zoneForScore(3, cuts, five, 3)).toBe(1);
    expect(zoneForScore(15, cuts, five, 3)).toBe(5);
  });

  it('works from a default zone at the end of the ladder', () => {
    expect(zoneForScore(20, [7.5, 10.5], three, 3)).toBe(3);
    expect(zoneForScore(9, [7.5, 10.5], three, 3)).toBe(2);
    expect(zoneForScore(0, [7.5, 10.5], three, 1)).toBe(1);
    expect(zoneForScore(11, [7.5, 10.5], three, 1)).toBe(3);
  });
});

describe('assignStartingZones', () => {
  it('uses the cuts, keeps ineligible players at the default, and lets overrides win', () => {
    const candidates = [candidate(5), candidate(5, false, 'thin'), candidate(12), candidate(9), candidate(0, false, 'forced')];
    const assigned = assignStartingZones(candidates, [7.3, 10.3], three, 2, { p12: 1, forced: 3 });
    expect(assigned).toEqual([
      { player_id: 'p5', zone: 1, source: 'cut' },
      { player_id: 'thin', zone: 2, source: 'insufficient' },
      { player_id: 'p12', zone: 1, source: 'override' },
      { player_id: 'p9', zone: 2, source: 'cut' },
      { player_id: 'forced', zone: 3, source: 'override' },
    ]);
  });
});

describe('expectedScore', () => {
  it('adds moving closer and subtracts moving farther, per zone', () => {
    expect(expectedScore(6, 2, 1, 3)).toBe(9);
    expect(expectedScore(12, 2, 3, 3)).toBe(9);
    expect(expectedScore(9, 2, 2, 3)).toBe(9);
    expect(expectedScore(12, 3, 1, 2)).toBe(16);
  });

  it('stays on the scale', () => {
    expect(expectedScore(2, 2, 3, 3)).toBe(0);
    expect(expectedScore(19, 2, 1, 3)).toBe(20);
  });
});

describe('binCandidates', () => {
  it('splits rows into eligible and ineligible, with 20 in the last bin', () => {
    const bins = binCandidates([candidate(0), candidate(0.99), candidate(1), candidate(1.5, false), candidate(20)]);
    expect(bins).toHaveLength(20);
    expect(bins[0]).toMatchObject({ from: 0, to: 1 });
    expect(bins[0].eligible).toHaveLength(2);
    expect(bins[1].eligible).toHaveLength(1);
    expect(bins[1].ineligible).toHaveLength(1);
    expect(bins[19].eligible).toHaveLength(1);
  });
});

describe('splitBin', () => {
  const binOf = (scores: number[]) => binCandidates(scores.map((score) => candidate(score)))[Math.floor(scores[0])];

  it('splits a bar at a cut inside the bin, keeping the counts exact', () => {
    expect(splitBin(binOf([7.1, 7.2, 7.8]), [7.3, 10.3], three, 2)).toEqual([
      { zone: 1, count: 2, from: 7, to: 7.3 },
      { zone: 2, count: 1, from: 7.3, to: 8 },
    ]);
  });

  it('leaves a bin with no cut whole', () => {
    expect(splitBin(binOf([8.5]), [7.3, 10.3], three, 2)).toEqual([{ zone: 2, count: 1, from: 8, to: 9 }]);
  });

  it('keeps a score exactly on a cut at the edge of its bin', () => {
    expect(splitBin(binOf([10, 10.5]), [7.3, 10], three, 2)).toEqual([
      { zone: 2, count: 1, from: 10, to: 10 },
      { zone: 3, count: 1, from: 10, to: 11 },
    ]);
  });
});

describe('clampCuts', () => {
  it('stops a moved cut at its neighbour without pushing it', () => {
    expect(clampCuts([12, 10], 0)).toEqual([9.9, 10]);
    expect(clampCuts([5, 3], 1)).toEqual([5, 5.1]);
  });

  it('snaps to 0.1 and stays on the scale', () => {
    expect(clampCuts([7.34, 10.26])).toEqual([7.3, 10.3]);
    expect(clampCuts([-3, 25], 0)).toEqual([0, 20]);
    expect(clampCuts([-3, 25], 1)).toEqual([0, 20]);
  });

  it('separates cuts stacked at the ends of the scale', () => {
    expect(clampCuts([7.5, 10.5, 20, 20])).toEqual([7.5, 10.5, 19.9, 20]);
    expect(clampCuts([0, 0, 7.5, 10.5])).toEqual([0, 0.1, 7.5, 10.5]);
  });

  it('lets the inner of two stacked cuts be dragged away', () => {
    expect(clampCuts([7.5, 10.5, 15, 20], 2)).toEqual([7.5, 10.5, 15, 20]);
  });
});
