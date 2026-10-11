import {
  emptyTeamDraft,
  sortBySlot,
  teamDraftFromPairings,
  teamDraftProblem,
  teamDraftToPairings,
  toStartBracketRequest,
} from '../team-utils';
import type { TeamPreview } from '@/lib/types/team';

const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('teamDraftProblem', () => {
  it('accepts every player on exactly one full team', () => {
    expect(teamDraftProblem([['a', 'b', 'c'], ['d', 'e', 'f']], ids, 3)).toBeNull();
  });

  it('counts unassigned players', () => {
    expect(teamDraftProblem([['a', 'b', null], ['d', null, null]], ids, 3)).toBe('3 players not on a team yet');
    expect(teamDraftProblem(emptyTeamDraft(6, 2), ids, 2)).toBe('6 players not on a team yet');
  });

  it('flags a player placed twice', () => {
    expect(teamDraftProblem([['a', 'b'], ['a', 'c'], ['d', 'e']], ids, 2)).toBe('A player is on more than one team');
  });

  it('flags a roster that does not split into teams', () => {
    expect(teamDraftProblem([], ids.slice(0, 5), 2)).toBe("5 players can't be split into teams of 2");
  });

  it('flags a player who left the roster', () => {
    expect(teamDraftProblem([['a', 'b'], ['c', 'gone']], ['a', 'b', 'c', 'd'], 2)).toBe('1 player not on a team yet');
    expect(teamDraftProblem([['a', 'b'], ['c', 'gone'], ['d', 'e']], ['a', 'b', 'c', 'd'], 2)).toBe(
      'The roster changed; clear the teams and start again'
    );
  });
});

describe('team drafts', () => {
  it('builds empty rows of team size', () => {
    expect(emptyTeamDraft(6, 3)).toEqual([[null, null, null], [null, null, null]]);
    expect(emptyTeamDraft(3, 1)).toEqual([[null], [null], [null]]);
  });

  it('round-trips through pairings with slots by position', () => {
    const pairings = teamDraftToPairings([['b', 'a'], ['c', 'd']]);
    expect(pairings.map((team) => team.members)).toEqual([
      [{ eventPlayerId: 'b', slot: 1 }, { eventPlayerId: 'a', slot: 2 }],
      [{ eventPlayerId: 'c', slot: 1 }, { eventPlayerId: 'd', slot: 2 }],
    ]);
    expect(teamDraftFromPairings([{ ...pairings[0], members: [...pairings[0].members].reverse() }])).toEqual([['b', 'a']]);
  });

  it('sorts members by slot without mutating', () => {
    const members = [{ slot: 2 }, { slot: 1 }];
    expect(sortBySlot(members)).toEqual([{ slot: 1 }, { slot: 2 }]);
    expect(members).toEqual([{ slot: 2 }, { slot: 1 }]);
  });
});

describe('toStartBracketRequest', () => {
  const players = [
    { eventPlayerId: 'a', playerName: 'A', pfaScore: 1, scoringMethod: 'pfa' as const, pool: 'A' as const },
    { eventPlayerId: 'b', playerName: 'B', pfaScore: 2, scoringMethod: 'pfa' as const, pool: 'B' as const },
  ];
  const teamPairings = [{ seed: 1, poolCombo: 'A & B', combinedScore: 3, members: [{ eventPlayerId: 'a', slot: 1 }, { eventPlayerId: 'b', slot: 2 }] }];

  it('sends pool choice only for the random doubles draw', () => {
    const pooled: TeamPreview = { teamSize: 2, teamAssignment: 'random_pairing', players, teamPairings };
    expect(toStartBracketRequest(pooled)).toEqual({
      poolAssignments: [{ eventPlayerId: 'a', pool: 'A' }, { eventPlayerId: 'b', pool: 'B' }],
      teamPairings: [{ members: teamPairings[0].members }],
    });
    const manual: TeamPreview = { ...pooled, teamAssignment: 'manual', teamPairings: [] };
    expect(toStartBracketRequest(manual, teamPairings)).toEqual({ teamPairings: [{ members: teamPairings[0].members }] });
  });
});
