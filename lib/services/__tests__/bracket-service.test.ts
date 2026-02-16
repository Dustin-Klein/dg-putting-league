/**
 * Bracket Service Tests
 *
 * Tests for bracket management functions:
 * - createBracket()
 * - getBracket()
 * - getBracketWithTeams()
 * - updateMatchResult()
 * - getReadyMatches()
 * - assignLaneToMatch()
 * - bracketExists()
 * - resetMatchResult()
 * - findMatchesToReset()
 */

import {
  BadRequestError,
  NotFoundError,
  InternalError,
} from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockEventWithDetails,
  createMockTeam,
  createMockUser,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/services/auth', () => ({
  requireAuthenticatedUser: jest.fn(),
}));

jest.mock('@/lib/services/event', () => ({
  requireEventAdmin: jest.fn(),
  getEventWithPlayers: jest.fn(),
}));

jest.mock('@/lib/services/team', () => ({
  getEventTeams: jest.fn(),
}));

jest.mock('@/lib/repositories/bracket-repository', () => ({
  SupabaseBracketStorage: jest.fn().mockImplementation(() => ({})),
  bracketStageExists: jest.fn(),
  getBracketParticipants: jest.fn(),
  linkParticipantsToTeams: jest.fn(),
  setEventIdOnMatches: jest.fn(),
  getMatchesByStageId: jest.fn(),
  bulkUpdateMatchStatuses: jest.fn(),
  updateMatchStatus: jest.fn(),
  getBracketStage: jest.fn(),
  fetchBracketStructure: jest.fn(),
  getParticipantsWithTeamIds: jest.fn(),
  getMatchWithStage: jest.fn(),
  getReadyMatchesByStageId: jest.fn(),
  assignLaneToMatchRpc: jest.fn(),
  getMatchForScoringById: jest.fn(),
  updateMatchWithOpponents: jest.fn(),
  getBracketResetContext: jest.fn(),
  deleteMatchFrames: jest.fn(),
  getMatchWithGroupInfo: jest.fn(),
  getSecondGrandFinalMatch: jest.fn(),
}));

jest.mock('@/lib/repositories/event-repository', () => ({
  getEventById: jest.fn(),
}));

const mockFindNextMatches = jest.fn();
const mockFindPreviousMatches = jest.fn();

jest.mock('brackets-manager', () => {
  const actual = jest.requireActual('brackets-manager');
  return {
    ...actual,
    BracketsManager: jest.fn().mockImplementation(() => ({
      create: {
        stage: jest.fn(),
      },
      update: {
        match: jest.fn(),
      },
      find: {
        nextMatches: mockFindNextMatches,
        previousMatches: mockFindPreviousMatches,
      },
    })),
  };
});

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { requireEventAdmin, getEventWithPlayers } from '@/lib/services/event';
import { getEventTeams } from '@/lib/services/team';
import {
  bracketStageExists,
  fetchBracketStructure,
  getBracketStage,
  getReadyMatchesByStageId,
  assignLaneToMatchRpc,
  getMatchWithStage,
  updateMatchWithOpponents,
  getBracketResetContext,
  deleteMatchFrames,
  getMatchWithGroupInfo,
  getSecondGrandFinalMatch,
  updateMatchStatus,
} from '@/lib/repositories/bracket-repository';
import {
  createBracket,
  getBracket,
  updateMatchResult,
  getReadyMatches,
  assignLaneToMatch,
  bracketExists,
  resetMatchResult,
  buildTaintedSlotPlan,
  findMatchesToReset,
} from '../bracket/bracket-service';

describe('Bracket Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireEventAdmin as jest.Mock).mockResolvedValue({ supabase: mockSupabase, user: createMockUser({ id: 'user-123' }) });
    mockFindNextMatches.mockResolvedValue([]);
    mockFindPreviousMatches.mockResolvedValue([]);
  });

  describe('createBracket', () => {
    const eventId = 'event-123';

    it('should throw BadRequestError for invalid event status', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'created' });
      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);

      await expect(createBracket(eventId)).rejects.toThrow(BadRequestError);
      await expect(createBracket(eventId)).rejects.toThrow(
        'Bracket can only be created for events in bracket status'
      );
    });

    it('should throw BadRequestError when bracket already exists', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'bracket' });
      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);
      (bracketStageExists as jest.Mock).mockResolvedValue(true);

      await expect(createBracket(eventId)).rejects.toThrow(BadRequestError);
      await expect(createBracket(eventId)).rejects.toThrow(
        'Bracket has already been created for this event'
      );
    });

    it('should throw BadRequestError when less than 2 teams', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'bracket' });
      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);
      (bracketStageExists as jest.Mock).mockResolvedValue(false);
      (getEventTeams as jest.Mock).mockResolvedValue([createMockTeam()]);

      await expect(createBracket(eventId)).rejects.toThrow(
        'At least 2 teams are required to create a bracket'
      );
    });

    it('should require event admin permission', async () => {
      (requireEventAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      await expect(createBracket(eventId)).rejects.toThrow('Not authorized');
    });
  });

  describe('getBracket', () => {
    const eventId = 'event-123';

    it('should throw NotFoundError when bracket not found', async () => {
      (fetchBracketStructure as jest.Mock).mockResolvedValue(null);

      await expect(getBracket(eventId)).rejects.toThrow(NotFoundError);
      await expect(getBracket(eventId)).rejects.toThrow('Bracket not found for this event');
    });

    it('should return bracket data when found', async () => {
      const mockBracketData = {
        stage: { id: 1, tournament_id: eventId },
        groups: [{ id: 1, stage_id: 1 }],
        rounds: [{ id: 1, stage_id: 1 }],
        matches: [{ id: 1, stage_id: 1 }],
        participants: [{ id: 1, tournament_id: eventId }],
      };
      (fetchBracketStructure as jest.Mock).mockResolvedValue(mockBracketData);

      const result = await getBracket(eventId);

      expect(result.stage).toBeDefined();
      expect(result.groups).toHaveLength(1);
      expect(result.rounds).toHaveLength(1);
      expect(result.matches).toHaveLength(1);
      expect(result.participants).toHaveLength(1);
    });
  });

  describe('getReadyMatches', () => {
    const eventId = 'event-123';

    it('should throw NotFoundError when bracket not found', async () => {
      (getBracketStage as jest.Mock).mockResolvedValue(null);

      await expect(getReadyMatches(eventId)).rejects.toThrow(NotFoundError);
      await expect(getReadyMatches(eventId)).rejects.toThrow('Bracket not found');
    });

    it('should return ready matches when bracket exists', async () => {
      (getBracketStage as jest.Mock).mockResolvedValue({ id: 1 });
      const mockMatches = [{ id: 1, status: 2 }, { id: 2, status: 2 }];
      (getReadyMatchesByStageId as jest.Mock).mockResolvedValue(mockMatches);

      const result = await getReadyMatches(eventId);

      expect(result).toEqual(mockMatches);
      expect(getBracketStage).toHaveBeenCalledWith(mockSupabase, eventId);
      expect(getReadyMatchesByStageId).toHaveBeenCalledWith(mockSupabase, 1);
    });
  });

  describe('assignLaneToMatch', () => {
    const eventId = 'event-123';
    const matchId = 1;
    const laneId = 'lane-123';

    it('should assign lane to match successfully', async () => {
      (assignLaneToMatchRpc as jest.Mock).mockResolvedValue(true);

      await expect(assignLaneToMatch(eventId, matchId, laneId)).resolves.not.toThrow();

      expect(assignLaneToMatchRpc).toHaveBeenCalledWith(mockSupabase, eventId, laneId, matchId);
    });

    it('should throw InternalError on RPC failure', async () => {
      (assignLaneToMatchRpc as jest.Mock).mockRejectedValue(
        new InternalError('Failed to assign lane to match: RPC failed')
      );

      await expect(assignLaneToMatch(eventId, matchId, laneId)).rejects.toThrow(
        InternalError
      );
    });

    it('should throw BadRequestError when lane not available', async () => {
      (assignLaneToMatchRpc as jest.Mock).mockRejectedValue(
        new BadRequestError('Lane is not available for assignment')
      );

      await expect(assignLaneToMatch(eventId, matchId, laneId)).rejects.toThrow(
        BadRequestError
      );
      await expect(assignLaneToMatch(eventId, matchId, laneId)).rejects.toThrow(
        'Lane is not available for assignment'
      );
    });
  });

  describe('bracketExists', () => {
    const eventId = 'event-123';

    it('should return true when bracket exists', async () => {
      (bracketStageExists as jest.Mock).mockResolvedValue(true);

      const result = await bracketExists(eventId);

      expect(result).toBe(true);
      expect(bracketStageExists).toHaveBeenCalledWith(mockSupabase, eventId);
    });

    it('should return false when bracket does not exist', async () => {
      (bracketStageExists as jest.Mock).mockResolvedValue(false);

      const result = await bracketExists(eventId);

      expect(result).toBe(false);
      expect(bracketStageExists).toHaveBeenCalledWith(mockSupabase, eventId);
    });

    it('should propagate InternalError when repository throws database error', async () => {
      (bracketStageExists as jest.Mock).mockRejectedValue(
        new InternalError('Failed to check bracket stage: DB error')
      );

      await expect(bracketExists(eventId)).rejects.toThrow(InternalError);
      await expect(bracketExists(eventId)).rejects.toThrow('Failed to check bracket stage');
    });
  });

  describe('updateMatchResult', () => {
    const eventId = 'event-123';
    const matchId = 1;

    it('should throw NotFoundError when match not found', async () => {
      (getMatchWithStage as jest.Mock).mockResolvedValue(null);

      await expect(updateMatchResult(eventId, matchId, 5, 3)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw BadRequestError when match belongs to different event', async () => {
      const mockMatch = {
        id: matchId,
        bracket_stage: { tournament_id: 'different-event' },
        opponent1: { id: 1 },
        opponent2: { id: 2 },
      };
      (getMatchWithStage as jest.Mock).mockResolvedValue(mockMatch);

      await expect(updateMatchResult(eventId, matchId, 5, 3)).rejects.toThrow(
        BadRequestError
      );
      await expect(updateMatchResult(eventId, matchId, 5, 3)).rejects.toThrow(
        'Match does not belong to this event'
      );
    });
  });

  describe('findMatchesToReset', () => {
    it('should return empty array when no downstream matches', () => {
      const target = { id: 1, number: 1, status: 4, round_id: 1, group_id: 1, opponent1: { id: 10 }, opponent2: { id: 20 } };
      const allMatches = [
        target,
        { id: 2, number: 2, status: 1, round_id: 2, group_id: 1, opponent1: null, opponent2: null },
      ];

      const result = findMatchesToReset(target, allMatches);
      expect(result).toHaveLength(0);
    });

    it('should cascade to downstream completed matches', () => {
      const target = { id: 1, number: 10, status: 4, round_id: 1, group_id: 1, opponent1: { id: 10 }, opponent2: { id: 20 } };
      const allMatches = [
        target,
        { id: 2, number: 11, status: 4, round_id: 2, group_id: 1, opponent1: { id: 10, position: 10 }, opponent2: { id: 30 } },
        { id: 3, number: 12, status: 4, round_id: 3, group_id: 1, opponent1: { id: 10, position: 11 }, opponent2: { id: 40 } },
      ];

      const result = findMatchesToReset(target, allMatches);
      expect(result).toHaveLength(2);
      // Deepest first
      expect(result[0].id).toBe(3);
      expect(result[1].id).toBe(2);
    });

    it('should include running matches in cascade', () => {
      const target = { id: 1, number: 1, status: 4, round_id: 1, group_id: 1, opponent1: { id: 10 }, opponent2: { id: 20 } };
      const allMatches = [
        target,
        { id: 2, number: 2, status: 3, round_id: 2, group_id: 1, opponent1: { id: 10, position: 1 }, opponent2: { id: 30 } },
      ];

      const result = findMatchesToReset(target, allMatches);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });

    it('should not include waiting or ready matches', () => {
      const target = { id: 1, number: 1, status: 4, round_id: 1, group_id: 1, opponent1: { id: 10 }, opponent2: { id: 20 } };
      const allMatches = [
        target,
        { id: 2, number: 2, status: 1, round_id: 2, group_id: 1, opponent1: { id: 10, position: 1 }, opponent2: null },
        { id: 3, number: 3, status: 2, round_id: 3, group_id: 1, opponent1: { id: 20, position: 2 }, opponent2: { id: 30 } },
      ];

      const result = findMatchesToReset(target, allMatches);
      expect(result).toHaveLength(0);
    });

    it('should follow transitive downstream links', () => {
      const target = { id: 1, number: 1, status: 4, round_id: 1, group_id: 1, opponent1: { id: 10 }, opponent2: { id: 20 } };
      const allMatches = [
        target,
        { id: 2, number: 2, status: 4, round_id: 2, group_id: 1, opponent1: { id: 10, position: 1 }, opponent2: { id: 30 } },
        { id: 3, number: 3, status: 4, round_id: 3, group_id: 1, opponent1: { id: 30, position: 2 }, opponent2: { id: 40 } },
      ];

      const result = findMatchesToReset(target, allMatches);
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toContain(2);
      expect(result.map((m) => m.id)).toContain(3);
    });

    it('should not include non-downstream matches even with overlapping participants', () => {
      const target = { id: 1, number: 1, status: 4, round_id: 1, group_id: 1, opponent1: { id: 10 }, opponent2: { id: 20 } };
      const allMatches = [
        target,
        { id: 2, number: 2, status: 4, round_id: 2, group_id: 1, opponent1: { id: 10 }, opponent2: { id: 30 } },
      ];

      const result = findMatchesToReset(target, allMatches);
      expect(result).toHaveLength(0);
    });

    it('should include locked matches in cascade', () => {
      const target = { id: 1, number: 1, status: 4, round_id: 1, group_id: 1, opponent1: { id: 10 }, opponent2: { id: 20 } };
      const allMatches = [
        target,
        { id: 2, number: 2, status: 0, round_id: 2, group_id: 1, opponent1: { id: 10, position: 1 }, opponent2: { id: 30 } }, // Locked match
      ];

      const result = findMatchesToReset(target, allMatches);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });

    it('should handle position values represented as strings', () => {
      const target = { id: 1, number: 1, status: 4, round_id: 1, group_id: 1, opponent1: { id: 10 }, opponent2: { id: 20 } };
      const allMatches = [
        target,
        // Some historical rows can contain stringified position values.
        { id: 2, number: 2, status: 4, round_id: 2, group_id: 1, opponent1: { id: 10, position: '1' as unknown as number }, opponent2: { id: 30 } },
      ];

      const result = findMatchesToReset(target, allMatches);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });

    it('should use participant fallback when position metadata is missing', () => {
      const target = { id: 1, number: 1, status: 4, round_id: 1, group_id: 1, opponent1: { id: 10 }, opponent2: { id: 20 } };
      const allMatches = [
        target,
        { id: 2, number: 2, status: 0, round_id: 2, group_id: 1, opponent1: { id: 10 }, opponent2: { id: 30 } },
      ];

      const result = findMatchesToReset(target, allMatches);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });
  });

  describe('buildTaintedSlotPlan', () => {
    it('should compute exact tainted slots through descendants, including waiting/locked nodes', async () => {
      const context = {
        stage: { id: 1, type: 'double_elimination', settings: {} },
        groups: [
          { id: 10, number: 1 },
          { id: 20, number: 2 },
          { id: 30, number: 3 },
        ],
        rounds: [
          { id: 101, group_id: 10, number: 1 },
          { id: 102, group_id: 10, number: 2 },
          { id: 103, group_id: 10, number: 3 },
          { id: 201, group_id: 20, number: 1 },
          { id: 202, group_id: 20, number: 2 },
          { id: 203, group_id: 20, number: 3 },
          { id: 204, group_id: 20, number: 4 },
          { id: 301, group_id: 30, number: 1 },
        ],
        matches: [
          { id: 97, stage_id: 1, group_id: 10, round_id: 101, number: 1, status: 4, opponent1: { id: 1001 }, opponent2: { id: 1002 } },
          { id: 112, stage_id: 1, group_id: 10, round_id: 102, number: 2, status: 4, opponent1: { id: 1101 }, opponent2: { id: 1102 } },
          { id: 127, stage_id: 1, group_id: 20, round_id: 201, number: 1, status: 4, opponent1: { id: 1201 }, opponent2: { id: 1202 } },
          { id: 119, stage_id: 1, group_id: 10, round_id: 103, number: 1, status: 4, opponent1: { id: 1901 }, opponent2: { id: 1902 } },
          { id: 135, stage_id: 1, group_id: 20, round_id: 202, number: 2, status: 4, opponent1: { id: 1301 }, opponent2: { id: 1302 } },
          { id: 140, stage_id: 1, group_id: 20, round_id: 202, number: 1, status: 1, opponent1: { id: 1401 }, opponent2: { id: 1402 } },
          { id: 145, stage_id: 1, group_id: 20, round_id: 203, number: 1, status: 0, opponent1: { id: 1451 }, opponent2: { id: 1452 } },
          { id: 148, stage_id: 1, group_id: 30, round_id: 301, number: 1, status: 1, opponent1: { id: 1481 }, opponent2: { id: 1482 } },
          { id: 123, stage_id: 1, group_id: 20, round_id: 204, number: 1, status: 1, opponent1: { id: 1231 }, opponent2: { id: 1232 } },
        ],
      };

      const graph: Record<number, number[]> = {
        97: [112, 127],
        112: [119, 140],
        127: [135],
        140: [145],
        145: [148],
      };

      const plan = await buildTaintedSlotPlan(97, context, async (id: number) => graph[id] || []);

      expect(plan.affectedMatchIds).toEqual([112, 127, 119, 135, 140, 145, 148]);
      expect(plan.taintedSlotsByMatch.get(112)).toEqual(new Set(['opponent1']));
      expect(plan.taintedSlotsByMatch.get(119)).toEqual(new Set(['opponent2']));
      expect(plan.taintedSlotsByMatch.get(145)).toEqual(new Set(['opponent1']));
    });

    it('should return affected matches in stable depth-then-id order', async () => {
      const context = {
        stage: { id: 1, type: 'double_elimination', settings: {} },
        groups: [{ id: 10, number: 1 }],
        rounds: [
          { id: 101, group_id: 10, number: 1 },
          { id: 102, group_id: 10, number: 2 },
          { id: 103, group_id: 10, number: 3 },
        ],
        matches: [
          { id: 1, stage_id: 1, group_id: 10, round_id: 101, number: 1, status: 4, opponent1: { id: 1 }, opponent2: { id: 2 } },
          { id: 2, stage_id: 1, group_id: 10, round_id: 102, number: 1, status: 1, opponent1: { id: 3 }, opponent2: { id: 4 } },
          { id: 4, stage_id: 1, group_id: 10, round_id: 102, number: 2, status: 1, opponent1: { id: 5 }, opponent2: { id: 6 } },
          { id: 3, stage_id: 1, group_id: 10, round_id: 103, number: 1, status: 1, opponent1: { id: 7 }, opponent2: { id: 8 } },
        ],
      };

      const graph: Record<number, number[]> = {
        1: [4, 2],
        2: [3],
      };

      const plan = await buildTaintedSlotPlan(1, context, async (id: number) => graph[id] || []);
      expect(plan.affectedMatchIds).toEqual([2, 4, 3]);
    });

    it('should prefer structural position mapping over loser-bracket helper fallback', async () => {
      const context = {
        stage: { id: 1, type: 'double_elimination', settings: {} },
        groups: [
          { id: 10, number: 1 },
          { id: 20, number: 2 },
        ],
        rounds: [
          { id: 101, group_id: 10, number: 1 },
          { id: 201, group_id: 20, number: 1 },
        ],
        matches: [
          { id: 1, stage_id: 1, group_id: 10, round_id: 101, number: 1, status: 4, opponent1: { id: 23 }, opponent2: { id: 24 } },
          { id: 2, stage_id: 1, group_id: 10, round_id: 101, number: 2, status: 4, opponent1: { id: 25 }, opponent2: { id: 21 } },
          // For this child, opponent2 explicitly points to match #2.
          // Match #1 therefore feeds opponent1 even though opponent1.position is missing.
          { id: 10, stage_id: 1, group_id: 20, round_id: 201, number: 1, status: 1, opponent1: { id: 25 }, opponent2: { id: 23, position: 2 } },
        ],
      };

      const graph: Record<number, number[]> = { 1: [10] };
      const plan = await buildTaintedSlotPlan(1, context, async (id: number) => graph[id] || []);

      expect(plan.affectedMatchIds).toEqual([10]);
      expect(plan.taintedSlotsByMatch.get(10)).toEqual(new Set(['opponent1']));
    });
  });

  describe('resetMatchResult', () => {
    const eventId = 'event-123';
    const matchId = 1;

    const makeContext = (status = 4) => ({
      stage: { id: 1, type: 'double_elimination', settings: {} },
      groups: [{ id: 10, number: 1 }],
      rounds: [{ id: 101, group_id: 10, number: 1 }],
      matches: [
        { id: 1, stage_id: 1, group_id: 10, round_id: 101, number: 1, status, opponent1: { id: 10, position: 1, score: 5, result: 'win' }, opponent2: { id: 20, position: 2, score: 3, result: 'loss' } },
      ],
    });

    it('should throw NotFoundError when match not found', async () => {
      (getBracketResetContext as jest.Mock).mockResolvedValue(makeContext());

      await expect(resetMatchResult(eventId, 999)).rejects.toThrow(NotFoundError);
      await expect(resetMatchResult(eventId, 999)).rejects.toThrow('Match not found');
    });

    it('should throw BadRequestError when match is not completed/running/archived', async () => {
      (getBracketResetContext as jest.Mock).mockResolvedValue(makeContext(2));

      await expect(resetMatchResult(eventId, matchId)).rejects.toThrow(BadRequestError);
      await expect(resetMatchResult(eventId, matchId)).rejects.toThrow(
        'Only completed, running, or archived matches can be reset'
      );
    });

    it('should rewrite target in two scrub steps and delete frames', async () => {
      (getBracketResetContext as jest.Mock).mockResolvedValue(makeContext(4));
      (getMatchWithGroupInfo as jest.Mock).mockResolvedValue(null);

      const result = await resetMatchResult(eventId, matchId);

      expect(result.resetMatchIds).toEqual([matchId]);
      expect(updateMatchWithOpponents).toHaveBeenCalledTimes(2);
      expect(updateMatchWithOpponents).toHaveBeenNthCalledWith(
        1,
        mockSupabase,
        matchId,
        { id: null },
        { id: null },
        1
      );
      expect(updateMatchWithOpponents).toHaveBeenNthCalledWith(
        2,
        mockSupabase,
        matchId,
        { id: 10 },
        { id: 20 },
        1
      );
      expect(deleteMatchFrames).toHaveBeenCalledTimes(1);
      expect(deleteMatchFrames).toHaveBeenCalledWith(mockSupabase, matchId);
    });

    it('should clear only tainted descendant slots and preserve unaffected entrants', async () => {
      (getBracketResetContext as jest.Mock).mockResolvedValue({
        stage: { id: 1, type: 'double_elimination', settings: {} },
        groups: [{ id: 10, number: 1 }],
        rounds: [{ id: 101, group_id: 10, number: 1 }, { id: 102, group_id: 10, number: 2 }],
        matches: [
          { id: 1, stage_id: 1, group_id: 10, round_id: 101, number: 1, status: 4, opponent1: { id: 10 }, opponent2: { id: 20 } },
          { id: 2, stage_id: 1, group_id: 10, round_id: 102, number: 1, status: 0, opponent1: { id: 10 }, opponent2: { id: 30 } },
        ],
      });
      (getMatchWithGroupInfo as jest.Mock).mockResolvedValue(null);
      mockFindNextMatches.mockResolvedValue([{ id: 2 }]);

      const result = await resetMatchResult(eventId, 1);

      expect(result.resetMatchIds).toEqual([1, 2]);
      expect(updateMatchWithOpponents).toHaveBeenCalledTimes(4);
      expect(updateMatchWithOpponents).toHaveBeenNthCalledWith(
        4,
        mockSupabase,
        2,
        { id: null },
        { id: 30 },
        1
      );
      expect(deleteMatchFrames).toHaveBeenCalledTimes(2);
      expect(deleteMatchFrames).toHaveBeenCalledWith(mockSupabase, 1);
      expect(deleteMatchFrames).toHaveBeenCalledWith(mockSupabase, 2);
    });

    it('should accept completed, running, and archived target statuses', async () => {
      for (const status of [4, 3, 5]) {
        (getBracketResetContext as jest.Mock).mockResolvedValue(makeContext(status));
        (getMatchWithGroupInfo as jest.Mock).mockResolvedValue(null);

        await expect(resetMatchResult(eventId, matchId)).resolves.toEqual({ resetMatchIds: [1] });
      }
    });

    it('should handle manager graph ids returned as strings', async () => {
      (getBracketResetContext as jest.Mock).mockResolvedValue({
        stage: { id: 1, type: 'double_elimination', settings: {} },
        groups: [{ id: 10, number: 1 }],
        rounds: [{ id: 101, group_id: 10, number: 1 }, { id: 102, group_id: 10, number: 2 }],
        matches: [
          { id: 1, stage_id: 1, group_id: 10, round_id: 101, number: 1, status: 4, opponent1: { id: 10 }, opponent2: { id: 20 } },
          { id: 2, stage_id: 1, group_id: 10, round_id: 102, number: 1, status: 1, opponent1: { id: 10 }, opponent2: { id: 30 } },
        ],
      });
      (getMatchWithGroupInfo as jest.Mock).mockResolvedValue(null);
      mockFindNextMatches.mockImplementation(async (id: number) => {
        if (id === 1) return [{ id: '2' as unknown as number }];
        return [];
      });

      const result = await resetMatchResult(eventId, 1);
      expect(result.resetMatchIds).toEqual([1, 2]);
    });

    it('should preserve literal null BYE slots instead of converting to {id:null}', async () => {
      (getBracketResetContext as jest.Mock).mockResolvedValue({
        stage: { id: 1, type: 'double_elimination', settings: {} },
        groups: [{ id: 10, number: 1 }, { id: 20, number: 2 }],
        rounds: [{ id: 101, group_id: 10, number: 1 }, { id: 201, group_id: 20, number: 1 }],
        matches: [
          { id: 1, stage_id: 1, group_id: 10, round_id: 101, number: 1, status: 4, opponent1: { id: 10 }, opponent2: { id: 20 } },
          { id: 2, stage_id: 1, group_id: 20, round_id: 201, number: 1, status: 1, opponent1: null, opponent2: { id: null, position: 2 } },
        ],
      });
      (getMatchWithGroupInfo as jest.Mock).mockResolvedValue(null);
      mockFindNextMatches.mockResolvedValue([{ id: 2 }]);

      const result = await resetMatchResult(eventId, 1);

      expect(result.resetMatchIds).toEqual([1, 2]);
      expect(updateMatchWithOpponents).toHaveBeenNthCalledWith(
        3,
        mockSupabase,
        2,
        null,
        { id: null },
        1
      );
      expect(updateMatchWithOpponents).toHaveBeenNthCalledWith(
        4,
        mockSupabase,
        2,
        null,
        { id: null },
        1
      );
    });

    it('should handle grand final reset match un-archiving', async () => {
      (getBracketResetContext as jest.Mock).mockResolvedValue(makeContext(4));
      (getMatchWithGroupInfo as jest.Mock).mockResolvedValue({
        id: matchId,
        group_id: 100,
        round_id: 1,
        status: 4,
        opponent1: { id: 10 },
        opponent2: { id: 20 },
        round: { number: 1, group: { number: 3 } },
      });
      (getSecondGrandFinalMatch as jest.Mock).mockResolvedValue({
        id: 99,
        status: 5,
      });

      await resetMatchResult(eventId, matchId);
      expect(updateMatchStatus).toHaveBeenCalledWith(mockSupabase, 99, 1);
    });
  });
});
