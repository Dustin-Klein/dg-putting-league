import { selectSecondChancePlayers, type PlacedPlayer } from '../linked-events';

// A completed 6-team doubles event (double elimination ties at 5th).
const placed: PlacedPlayer[] = [
  { teamId: 't1', placement: 1, playerId: 'p1' },
  { teamId: 't1', placement: 1, playerId: 'p2' },
  { teamId: 't2', placement: 2, playerId: 'p3' },
  { teamId: 't2', placement: 2, playerId: 'p4' },
  { teamId: 't3', placement: 3, playerId: 'p5' },
  { teamId: 't3', placement: 3, playerId: 'p6' },
  { teamId: 't4', placement: 4, playerId: 'p7' },
  { teamId: 't4', placement: 4, playerId: 'p8' },
  { teamId: 't5', placement: 5, playerId: 'p9' },
  { teamId: 't5', placement: 5, playerId: 'p10' },
  { teamId: 't6', placement: 5, playerId: 'p11' },
  { teamId: 't6', placement: 5, playerId: 'p12' },
];

describe('selectSecondChancePlayers', () => {
  it('excludes only the winning team, every member of it', () => {
    expect(selectSecondChancePlayers(placed)).toEqual(
      ['p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12']
    );
  });

  it('handles singles teams and de-duplicates players', () => {
    expect(selectSecondChancePlayers([
      { teamId: 'a', placement: 1, playerId: 'x' },
      { teamId: 'b', placement: 2, playerId: 'y' },
      { teamId: 'b', placement: 2, playerId: 'y' },
    ])).toEqual(['y']);
  });

  it('returns nobody when nothing is placed', () => {
    expect(selectSecondChancePlayers([])).toEqual([]);
  });
});
