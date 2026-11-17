import {
  computeEventPlacements,
  isSingleEliminationDecided,
  placeDecidedMatchesDetailed,
  type PlacementMatch,
} from '../placements';

/**
 * An 8-team single-elimination bracket: group 1 rounds 1-3 (QF, SF, F), optional
 * group 2 third-place match. Participant n is team-n; the lower id always wins.
 */
function eightTeamBracket({ thirdPlace = false, playFinal = true, playThird = true } = {}) {
  const groups = [{ id: 1, number: 1 }, ...(thirdPlace ? [{ id: 2, number: 2 }] : [])];
  const rounds = [
    { id: 11, group_id: 1, number: 1 },
    { id: 12, group_id: 1, number: 2 },
    { id: 13, group_id: 1, number: 3 },
    ...(thirdPlace ? [{ id: 21, group_id: 2, number: 1 }] : []),
  ];
  let nextId = 1;
  const played = (round_id: number, a: number, b: number): PlacementMatch => ({
    id: nextId++,
    round_id,
    status: 4,
    opponent1: { id: a, result: a < b ? 'win' : 'loss' },
    opponent2: { id: b, result: a < b ? 'loss' : 'win' },
  });
  const pending = (round_id: number, a: number, b: number): PlacementMatch => ({
    id: nextId++, round_id, status: 2, opponent1: { id: a }, opponent2: { id: b },
  });
  const matches = [
    played(11, 1, 8), played(11, 4, 5), played(11, 2, 7), played(11, 3, 6),
    played(12, 1, 4), played(12, 2, 3),
    playFinal ? played(13, 1, 2) : pending(13, 1, 2),
    ...(thirdPlace ? [playThird ? played(21, 4, 3) : pending(21, 4, 3)] : []),
  ];
  const participants = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, team_id: `team-${i + 1}` }));
  return { eventId: 'event-1', format: 'single_elimination' as const, groups, rounds, matches, participants };
}

const teamOrder = (placements: Array<{ teamId: string }>) => placements.map((placement) => placement.teamId);

describe('computeEventPlacements (single elimination)', () => {
  it('places the champion first, the finalist second, then losers by round', () => {
    expect(teamOrder(computeEventPlacements(eightTeamBracket()))).toEqual([
      'team-1', 'team-2', 'team-4', 'team-3', 'team-8', 'team-5', 'team-7', 'team-6',
    ]);
  });

  it('places the third-place match winner and loser third and fourth', () => {
    const placements = computeEventPlacements(eightTeamBracket({ thirdPlace: true }));
    expect(teamOrder(placements).slice(0, 4)).toEqual(['team-1', 'team-2', 'team-3', 'team-4']);
    expect(placements.map((placement) => placement.placement)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('does not place a semifinal winner first while the final is unplayed', () => {
    const placements = computeEventPlacements(eightTeamBracket({ playFinal: false }));
    expect(teamOrder(placements)).toEqual(['team-4', 'team-3', 'team-8', 'team-5', 'team-7', 'team-6']);
  });

  it('places a two-team bracket from its only match', () => {
    const result = computeEventPlacements({
      eventId: 'event-1',
      format: 'single_elimination',
      groups: [{ id: 1, number: 1 }],
      rounds: [{ id: 11, group_id: 1, number: 1 }],
      matches: [{ id: 1, round_id: 11, status: 4, opponent1: { id: 1, result: 'loss' }, opponent2: { id: 2, result: 'win' } }],
      participants: [{ id: 1, team_id: 'team-1' }, { id: 2, team_id: 'team-2' }],
    });
    expect(teamOrder(result)).toEqual(['team-2', 'team-1']);
  });
});

describe('placeDecidedMatchesDetailed', () => {
  it('records the match that decided each placement', () => {
    const placements = placeDecidedMatchesDetailed('event-1', 'single_elimination', [
      { id: 1, groupNumber: 1, roundNumber: 1, isLastRoundOfGroup: false, winnerTeamId: 'a', loserTeamId: 'c' },
      { id: 2, groupNumber: 1, roundNumber: 2, isLastRoundOfGroup: true, winnerTeamId: 'a', loserTeamId: 'b' },
    ]);
    expect(placements.map(({ teamId, won, decidedBy }) => [teamId, won, decidedBy.id])).toEqual([
      ['a', true, 2], ['b', false, 2], ['c', false, 1],
    ]);
  });
});

describe('isSingleEliminationDecided', () => {
  const decided = (options: Parameters<typeof eightTeamBracket>[0]) => {
    const { groups, rounds, matches } = eightTeamBracket(options);
    return isSingleEliminationDecided(groups, rounds, matches);
  };

  it('needs the final', () => {
    expect(decided({})).toBe(true);
    expect(decided({ playFinal: false })).toBe(false);
  });

  it('needs a generated third-place match', () => {
    expect(decided({ thirdPlace: true })).toBe(true);
    expect(decided({ thirdPlace: true, playThird: false })).toBe(false);
  });

  it('does not wait for a third-place match that is a bye', () => {
    const { groups, rounds, matches } = eightTeamBracket({ thirdPlace: true, playThird: false });
    const withBye = matches.map((match) => (match.round_id === 21 ? { ...match, opponent2: null } : match));
    expect(isSingleEliminationDecided(groups, rounds, withBye)).toBe(true);
  });

  it('is never decided without a main bracket', () => {
    expect(isSingleEliminationDecided([], [], [])).toBe(false);
  });
});
