import { BadRequestError, ConflictError } from '@/lib/errors';
import type { PoolAssignment } from '@/lib/services/event-player';
import type { TeamPairing } from '@/lib/services/team';
import { validatePreviewPayload } from '../preview';

const assignments: PoolAssignment[] = [
  { eventPlayerId: 'a1', playerId: 'p1', playerName: 'A One', pool: 'A', pfaScore: 10, scoringMethod: 'pfa', defaultPool: 'A' },
  { eventPlayerId: 'a2', playerId: 'p2', playerName: 'A Two', pool: 'A', pfaScore: 8, scoringMethod: 'pfa', defaultPool: 'A' },
  { eventPlayerId: 'b1', playerId: 'p3', playerName: 'B One', pool: 'B', pfaScore: 7, scoringMethod: 'pfa', defaultPool: 'B' },
  { eventPlayerId: 'b2', playerId: 'p4', playerName: 'B Two', pool: 'B', pfaScore: 5, scoringMethod: 'default', defaultPool: 'B' },
];

const teams: TeamPairing[] = [
  { seed: 99, poolCombo: 'spoofed', combinedScore: 999, members: [{ eventPlayerId: 'a1', role: 'A_pool', slot: 1 }, { eventPlayerId: 'b2', role: 'B_pool', slot: 2 }] },
  { seed: 98, poolCombo: 'spoofed', combinedScore: 998, members: [{ eventPlayerId: 'a2', role: 'A_pool', slot: 1 }, { eventPlayerId: 'b1', role: 'B_pool', slot: 2 }] },
];

describe('validatePreviewPayload', () => {
  it('rejects a stale player set with a conflict', () => {
    expect(() => validatePreviewPayload({
      currentEventPlayerIds: [...assignments.map((item) => item.eventPlayerId), 'new'],
      recomputedPoolAssignments: assignments,
      providedPoolAssignments: assignments,
      providedTeamPairings: teams,
    })).toThrow(ConflictError);
  });

  it('rejects foreign and duplicate team members', () => {
    const foreign = structuredClone(teams);
    foreign[0].members[0].eventPlayerId = 'foreign';
    expect(() => validatePreviewPayload({
      currentEventPlayerIds: assignments.map((item) => item.eventPlayerId),
      recomputedPoolAssignments: assignments,
      providedPoolAssignments: assignments,
      providedTeamPairings: foreign,
    })).toThrow(BadRequestError);

    const duplicate = structuredClone(teams);
    duplicate[1].members[0].eventPlayerId = 'a1';
    expect(() => validatePreviewPayload({
      currentEventPlayerIds: assignments.map((item) => item.eventPlayerId),
      recomputedPoolAssignments: assignments,
      providedPoolAssignments: assignments,
      providedTeamPairings: duplicate,
    })).toThrow(BadRequestError);
  });

  it('accepts manual pairs and ignores all client-derived fields', () => {
    const spoofedAssignments = assignments.map((item) => ({
      ...item,
      pfaScore: 500,
      scoringMethod: 'default' as const,
      playerName: 'Spoofed',
    }));
    const result = validatePreviewPayload({
      currentEventPlayerIds: assignments.map((item) => item.eventPlayerId),
      recomputedPoolAssignments: assignments,
      providedPoolAssignments: spoofedAssignments,
      providedTeamPairings: teams,
    });

    expect(result.poolAssignments.map((item) => item.pfaScore)).toEqual([10, 8, 7, 5]);
    expect(result.teamPairings).toEqual([
      expect.objectContaining({ seed: 1, combinedScore: 15, poolCombo: 'A One & B Two' }),
      expect.objectContaining({ seed: 2, combinedScore: 15, poolCombo: 'A Two & B One' }),
    ]);
  });
});
