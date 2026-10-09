import { computeEventPlacements, isBracketDecided } from '../placements';

describe('isBracketDecided', () => {
  const completed = (roundNumber: number, opponent2Wins = false) => ({
    roundNumber,
    status: 4,
    opponent1: { id: 1, result: opponent2Wins ? 'loss' : 'win' },
    opponent2: { id: 2, result: opponent2Wins ? 'win' : 'loss' },
  });

  it('requires a completed first grand final with a result', () => {
    expect(isBracketDecided([], true)).toBe(false);
    expect(isBracketDecided([{ ...completed(1), status: 3 }], true)).toBe(false);
  });

  it('does not require the reset when the winners-bracket champion wins', () => {
    expect(isBracketDecided([completed(1)], true)).toBe(true);
  });

  it('requires the reset when the losers-bracket champion wins and double final is enabled', () => {
    expect(isBracketDecided([completed(1, true)], true)).toBe(false);
    expect(isBracketDecided([completed(1, true), completed(2)], true)).toBe(true);
    expect(isBracketDecided([completed(1, true)], false)).toBe(true);
  });
});

describe('computeEventPlacements', () => {
  it('orders grand-final teams first and ignores result-less advances', () => {
    const result = computeEventPlacements({
      eventId: 'event-1',
      groups: [{ id: 1, number: 1 }, { id: 2, number: 2 }, { id: 3, number: 3 }],
      rounds: [
        { id: 11, group_id: 1, number: 1 },
        { id: 21, group_id: 2, number: 1 },
        { id: 31, group_id: 3, number: 1 },
      ],
      matches: [
        { id: 1, round_id: 11, status: 4, opponent1: { id: 3 }, opponent2: { id: 4 } },
        { id: 2, round_id: 21, status: 4, opponent1: { id: 2, result: 'win' }, opponent2: { id: 3, result: 'loss' } },
        { id: 3, round_id: 31, status: 5, opponent1: { id: 1, result: 'win' }, opponent2: { id: 2, result: 'loss' } },
      ],
      participants: [1, 2, 3, 4].map((id) => ({ id, team_id: `team-${id}` })),
    });

    expect(result).toEqual([
      { eventId: 'event-1', teamId: 'team-1', placement: 1 },
      { eventId: 'event-1', teamId: 'team-2', placement: 2 },
      { eventId: 'event-1', teamId: 'team-3', placement: 3 },
    ]);
  });
});
