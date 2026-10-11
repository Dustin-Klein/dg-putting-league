import { BadRequestError, ConflictError } from '@/lib/errors';
import { STALE_PREVIEW_MESSAGE } from '@/lib/constants/event';
import type { PlayerScore, PoolAssignment } from '@/lib/services/event-player';
import type { TeamPairing } from '@/lib/services/team/composition';
import {
  assertRosterCurrent,
  resolvePoolAssignments,
  validatePoolPairing,
  validateTeamComposition,
  type ProvidedTeamPairing,
} from '../preview';

const assignments: PoolAssignment[] = [
  { eventPlayerId: 'a1', playerId: 'p1', playerName: 'A One', pool: 'A', pfaScore: 10, scoringMethod: 'pfa', defaultPool: 'A' },
  { eventPlayerId: 'a2', playerId: 'p2', playerName: 'A Two', pool: 'A', pfaScore: 8, scoringMethod: 'pfa', defaultPool: 'A' },
  { eventPlayerId: 'b1', playerId: 'p3', playerName: 'B One', pool: 'B', pfaScore: 7, scoringMethod: 'pfa', defaultPool: 'B' },
  { eventPlayerId: 'b2', playerId: 'p4', playerName: 'B Two', pool: 'B', pfaScore: 5, scoringMethod: 'default', defaultPool: 'B' },
];

const doublesTeams: TeamPairing[] = [
  { seed: 99, poolCombo: 'spoofed', combinedScore: 999, members: [{ eventPlayerId: 'a1', slot: 1 }, { eventPlayerId: 'b2', slot: 2 }] },
  { seed: 98, poolCombo: 'spoofed', combinedScore: 998, members: [{ eventPlayerId: 'a2', slot: 1 }, { eventPlayerId: 'b1', slot: 2 }] },
];

/** `n` players P1..Pn scoring 1..n. */
function roster(n: number): PlayerScore[] {
  return Array.from({ length: n }, (_, i) => ({
    eventPlayerId: `ep${i + 1}`,
    playerId: `p${i + 1}`,
    playerName: `P${i + 1}`,
    pfaScore: i + 1,
    scoringMethod: 'pfa' as const,
    defaultPool: 'A' as const,
  }));
}

/** Consecutive players in teams of `size`: [[ep1, ep2], [ep3, ep4], ...]. */
function chunked(n: number, size: number): ProvidedTeamPairing[] {
  return Array.from({ length: n / size }, (_, t) => ({
    members: Array.from({ length: size }, (_, s) => ({ eventPlayerId: `ep${t * size + s + 1}`, slot: s + 1 })),
  }));
}

describe('validateTeamComposition', () => {
  describe.each([1, 2, 3])('team size %i', (size) => {
    const players = roster(size * 2);

    it('accepts every player on exactly one team and seeds by combined score', () => {
      const teams = validateTeamComposition({ players, teams: chunked(size * 2, size), teamSize: size });
      expect(teams.map((team) => team.seed)).toEqual([1, 2]);
      // The second chunk holds the higher scores.
      expect(teams[0].members.map((m) => m.eventPlayerId)).toEqual(
        players.slice(size).map((player) => player.eventPlayerId)
      );
      expect(teams[0].members.map((m) => m.slot)).toEqual(Array.from({ length: size }, (_, i) => i + 1));
    });

    it('rejects a team with the wrong member count', () => {
      const teams = chunked(size * 2, size);
      teams[0].members.push({ eventPlayerId: 'ep1', slot: size + 1 });
      expect(() => validateTeamComposition({ players, teams, teamSize: size })).toThrow(
        `Each team must have exactly ${size} member`
      );
    });

    it('rejects a player on two teams', () => {
      const teams = chunked(size * 2, size);
      teams[1].members[0] = { ...teams[0].members[0], slot: 1 };
      expect(() => validateTeamComposition({ players, teams, teamSize: size })).toThrow(
        'A player cannot be assigned to more than one team'
      );
    });

    it('treats a player on no team as a stale roster', () => {
      expect(() =>
        validateTeamComposition({ players: roster(size * 3), teams: chunked(size * 2, size), teamSize: size })
      ).toThrow(new ConflictError(STALE_PREVIEW_MESSAGE));
    });

    it('treats a team naming an unregistered player as a stale roster', () => {
      const teams = chunked(size * 2, size);
      teams[1].members[size - 1] = { eventPlayerId: 'gone', slot: size };
      expect(() => validateTeamComposition({ players, teams, teamSize: size })).toThrow(ConflictError);
    });
  });

  it.each([2, 3])('rejects a duplicate member within a team of %i', (size) => {
    const teams = chunked(size * 2, size);
    teams[0].members[1] = { eventPlayerId: teams[0].members[0].eventPlayerId, slot: 2 };
    expect(() => validateTeamComposition({ players: roster(size * 2), teams, teamSize: size })).toThrow(
      'A player cannot appear more than once in a team'
    );
  });

  it.each([
    [[1, 1, 2]],
    [[0, 1, 2]],
    [[1, 2, 4]],
    [[1, 2, 2.5]],
  ])('rejects slots %j in a team of 3', (slots) => {
    const teams = chunked(6, 3);
    teams[0].members.forEach((member, i) => {
      member.slot = slots[i];
    });
    expect(() => validateTeamComposition({ players: roster(6), teams, teamSize: 3 })).toThrow(
      'Team slots must be 1 to 3, each used once'
    );
  });

  it.each([
    [2, 5, "5 players can't be split into teams of 2: add 1 player or remove 1 player"],
    [3, 7, "7 players can't be split into teams of 3: add 2 players or remove 1 player"],
    [3, 8, "8 players can't be split into teams of 3: add 1 player or remove 2 players"],
  ])('rejects leftover players at team size %i (%i players)', (size, n, message) => {
    expect(() => validateTeamComposition({ players: roster(n), teams: [], teamSize: size })).toThrow(
      new BadRequestError(message)
    );
  });

  it('orders members by slot and overwrites forged identity, name and score fields', () => {
    const players = roster(6);
    const forged: ProvidedTeamPairing[] = [
      {
        seed: 1,
        poolCombo: 'Forged',
        combinedScore: 1000,
        members: [
          { eventPlayerId: 'ep3', slot: 3 },
          { eventPlayerId: 'ep1', slot: 1 },
          { eventPlayerId: 'ep2', slot: 2 },
        ],
      },
      { seed: 2, poolCombo: 'Forged too', combinedScore: -5, members: chunked(6, 3)[1].members },
    ];

    const teams = validateTeamComposition({ players, teams: forged, teamSize: 3 });

    expect(teams).toEqual([
      {
        seed: 1,
        poolCombo: 'P4 & P5 & P6',
        combinedScore: 15,
        members: [{ eventPlayerId: 'ep4', slot: 1 }, { eventPlayerId: 'ep5', slot: 2 }, { eventPlayerId: 'ep6', slot: 3 }],
      },
      {
        seed: 2,
        poolCombo: 'P1 & P2 & P3',
        combinedScore: 6,
        members: [{ eventPlayerId: 'ep1', slot: 1 }, { eventPlayerId: 'ep2', slot: 2 }, { eventPlayerId: 'ep3', slot: 3 }],
      },
    ]);
  });

  it('keeps the submitted order for tied teams', () => {
    const teams = validateTeamComposition({ players: assignments, teams: doublesTeams, teamSize: 2 });
    expect(teams).toEqual([
      expect.objectContaining({ seed: 1, combinedScore: 15, poolCombo: 'A One & B Two' }),
      expect.objectContaining({ seed: 2, combinedScore: 15, poolCombo: 'A Two & B One' }),
    ]);
  });
});

describe('validatePoolPairing', () => {
  const composed = validateTeamComposition({ players: assignments, teams: doublesTeams, teamSize: 2 });

  it('accepts one Pool A and one Pool B player per team, in either slot order', () => {
    expect(() => validatePoolPairing({ teams: composed, assignments })).not.toThrow();
    const swapped = composed.map((team) => ({
      ...team,
      members: team.members.map((member) => ({ ...member, slot: 3 - member.slot })),
    }));
    expect(() => validatePoolPairing({ teams: swapped, assignments })).not.toThrow();
  });

  it('rejects a team from a single pool', () => {
    const samePool = validateTeamComposition({
      players: assignments,
      teams: [
        { members: [{ eventPlayerId: 'a1', slot: 1 }, { eventPlayerId: 'a2', slot: 2 }] },
        { members: [{ eventPlayerId: 'b1', slot: 1 }, { eventPlayerId: 'b2', slot: 2 }] },
      ],
      teamSize: 2,
    });
    expect(() => validatePoolPairing({ teams: samePool, assignments })).toThrow(
      'Each team must contain one Pool A player and one Pool B player'
    );
  });

  it('checks against the resolved pools, not the defaults', () => {
    const moved = assignments.map((a) => (a.eventPlayerId === 'b2' ? { ...a, pool: 'A' as const } : a));
    expect(() => validatePoolPairing({ teams: composed, assignments: moved })).toThrow(BadRequestError);
  });
});

describe('resolvePoolAssignments', () => {
  it('takes only the pool choice from the client', () => {
    const spoofed = assignments.map((item) => ({
      ...item,
      pool: item.pool === 'A' ? ('B' as const) : ('A' as const),
      pfaScore: 500,
      scoringMethod: 'default' as const,
      playerName: 'Spoofed',
    }));
    const resolved = resolvePoolAssignments({ players: assignments, providedPoolAssignments: spoofed });
    expect(resolved.map((item) => [item.pfaScore, item.playerName, item.pool])).toEqual([
      [10, 'A One', 'B'],
      [8, 'A Two', 'B'],
      [7, 'B One', 'A'],
      [5, 'B Two', 'A'],
    ]);
  });

  it('rejects a duplicated player and a stale player set', () => {
    expect(() =>
      resolvePoolAssignments({ players: assignments, providedPoolAssignments: [...assignments, assignments[0]] })
    ).toThrow(BadRequestError);
    expect(() =>
      resolvePoolAssignments({ players: assignments, providedPoolAssignments: assignments.slice(1) })
    ).toThrow(ConflictError);
  });
});

describe('assertRosterCurrent', () => {
  it('rejects scores that no longer match the registered players', () => {
    const ids = assignments.map((item) => item.eventPlayerId);
    expect(() => assertRosterCurrent(ids, assignments)).not.toThrow();
    expect(() => assertRosterCurrent([...ids, 'new'], assignments)).toThrow(new ConflictError(STALE_PREVIEW_MESSAGE));
    expect(() => assertRosterCurrent(ids.slice(1), assignments)).toThrow(ConflictError);
  });
});
