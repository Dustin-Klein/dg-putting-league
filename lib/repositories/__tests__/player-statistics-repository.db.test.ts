import {
  calculateEventPlacements,
  type PlacementMatchData,
} from '../player-statistics-repository.db';

function match(overrides: Partial<PlacementMatchData>): PlacementMatchData {
  return {
    id: 1,
    eventId: 'event-1',
    groupNumber: 3,
    roundNumber: 1,
    opponent1: { id: 1, result: 'win' },
    opponent2: { id: 2, result: 'loss' },
    opponent1TeamId: 'team-1',
    opponent2TeamId: 'team-2',
    ...overrides,
  };
}

describe('calculateEventPlacements', () => {
  it('calculates first and second place from the latest grand final', () => {
    expect(calculateEventPlacements('event-1', [match({})])).toEqual([
      { eventId: 'event-1', teamId: 'team-1', placement: 1 },
      { eventId: 'event-1', teamId: 'team-2', placement: 2 },
    ]);
  });

  it('ignores matches from other events and returns empty without completed matches', () => {
    expect(calculateEventPlacements('event-1', [match({ eventId: 'event-2' })])).toEqual([]);
  });

  it('adds loser-bracket eliminations after grand-final placements', () => {
    const matches = [
      match({}),
      match({
        id: 2,
        groupNumber: 2,
        roundNumber: 3,
        opponent1: { id: 3, result: 'win' },
        opponent2: { id: 4, result: 'loss' },
        opponent1TeamId: 'team-2',
        opponent2TeamId: 'team-3',
      }),
    ];

    expect(calculateEventPlacements('event-1', matches)).toEqual([
      { eventId: 'event-1', teamId: 'team-1', placement: 1 },
      { eventId: 'event-1', teamId: 'team-2', placement: 2 },
      { eventId: 'event-1', teamId: 'team-3', placement: 3 },
    ]);
  });
});
