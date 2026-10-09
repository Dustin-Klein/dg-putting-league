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
 */

import {
  NotFoundError,
  InternalError,
} from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockUser,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/services/auth', () => ({
  requireAuthenticatedUser: jest.fn(),
  authorizeEventView: jest.fn(),
}));

jest.mock('@/lib/services/event', () => ({
  requireEventAdmin: jest.fn(),
}));

jest.mock('@/lib/repositories/bracket-repository', () => ({
  bracketStageExists: jest.fn(),
  getBracketStage: jest.fn(),
  fetchBracketStructure: jest.fn(),
  getParticipantsWithTeamIds: jest.fn(),
  getReadyMatchesByStageId: jest.fn(),
  getMatchForScoringById: jest.fn(),
  getFrameCountsForMatchIds: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/lib/repositories/event-repository.db', () => ({
  getEventById: jest.fn(),
  getEventAccessCode: jest.fn(),
}));

jest.mock('@/lib/repositories/team-repository', () => ({
  getFullTeamsForEvent: jest.fn(),
  getPublicTeamsForEvent: jest.fn(),
}));

jest.mock('@/lib/repositories/lane-repository', () => ({
  getLanesForEvent: jest.fn(),
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
import { requireEventAdmin } from '@/lib/services/event';
import {
  bracketStageExists,
  fetchBracketStructure,
  getBracketStage,
  getReadyMatchesByStageId,
} from '@/lib/repositories/bracket-repository';
import { getEventById } from '@/lib/repositories/event-repository.db';
import { authorizeEventView } from '@/lib/services/auth';
import {
  getBracket,
  getPublicBracket,
  getReadyMatches,
  bracketExists,
  buildProgressionSourceMap,
  buildTaintedSlotPlan,
} from '../bracket/bracket-service';
import { getPublicTeamsForEvent } from '@/lib/repositories/team-repository';
import { getLanesForEvent } from '@/lib/repositories/lane-repository';

describe('Bracket Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireEventAdmin as jest.Mock).mockResolvedValue({ supabase: mockSupabase, pg: mockSupabase, user: createMockUser({ id: 'user-123' }) });
    (authorizeEventView as jest.Mock).mockResolvedValue({ pg: mockSupabase, isAdmin: false });
    mockFindNextMatches.mockResolvedValue([]);
    mockFindPreviousMatches.mockResolvedValue([]);
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

  describe('getPublicBracket', () => {
    const eventId = 'event-123';

    it('does not query bracket data when visibility authorization fails', async () => {
      (authorizeEventView as jest.Mock).mockRejectedValueOnce(new NotFoundError('Event not found'));
      await expect(getPublicBracket(eventId)).rejects.toThrow(NotFoundError);
      expect(getEventById).not.toHaveBeenCalled();
      expect(fetchBracketStructure).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError when event does not exist', async () => {
      (getEventById as jest.Mock).mockResolvedValue(null);

      await expect(getPublicBracket(eventId)).rejects.toThrow(NotFoundError);
      await expect(getPublicBracket(eventId)).rejects.toThrow('Event not found');
    });

    it('should throw NotFoundError when event is not in bracket/completed status', async () => {
      (getEventById as jest.Mock).mockResolvedValue({ id: eventId, status: 'created' });

      await expect(getPublicBracket(eventId)).rejects.toThrow(NotFoundError);
      await expect(getPublicBracket(eventId)).rejects.toThrow('Bracket not available for this event');
    });

    it('should use public team query and return bracket with mappings', async () => {
      (getEventById as jest.Mock).mockResolvedValue({ id: eventId, status: 'bracket', double_grand_final: true });
      (fetchBracketStructure as jest.Mock).mockResolvedValue({
        stage: { id: 1, tournament_id: eventId },
        groups: [{ id: 1, stage_id: 1 }],
        rounds: [{ id: 1, stage_id: 1 }],
        matches: [{ id: 1, stage_id: 1 }],
        participants: [{ id: 10, team_id: 'team-1' }],
      });
      (getPublicTeamsForEvent as jest.Mock).mockResolvedValue([
        {
          id: 'team-1',
          event_id: eventId,
          seed: 1,
          pool_combo: 'A & B',
          created_at: '2024-01-01T00:00:00Z',
          team_members: [],
        },
      ]);
      (getLanesForEvent as jest.Mock).mockResolvedValue([
        { id: 'lane-1', event_id: eventId, label: 'Lane 1', status: 'idle' },
      ]);

      const result = await getPublicBracket(eventId);

      expect(getPublicTeamsForEvent).toHaveBeenCalledWith(mockSupabase, eventId);
      expect(result.participantTeamMap[10]?.id).toBe('team-1');
      expect(result.laneMap['lane-1']).toBe('Lane 1');
      expect(result.eventStatus).toBe('bracket');
    });

    it('should filter out the reset round and its matches when double_grand_final is false', async () => {
      // GF group is number 3; reset round is number 2 in that group
      const gfGroupId = 10;
      const gfRound1Id = 20;
      const gfRound2Id = 21; // reset round
      (getEventById as jest.Mock).mockResolvedValue({
        id: eventId,
        status: 'bracket',
        double_grand_final: false,
      });
      (fetchBracketStructure as jest.Mock).mockResolvedValue({
        stage: { id: 1, tournament_id: eventId },
        groups: [
          { id: 1, stage_id: 1, number: 1 },
          { id: gfGroupId, stage_id: 1, number: 3 },
        ],
        rounds: [
          { id: gfRound1Id, group_id: gfGroupId, number: 1 },
          { id: gfRound2Id, group_id: gfGroupId, number: 2 },
        ],
        matches: [
          { id: 1, round_id: gfRound1Id, status: 4 },
          { id: 2, round_id: gfRound2Id, status: 2 }, // reset match — should be filtered
        ],
        participants: [],
      });
      (getPublicTeamsForEvent as jest.Mock).mockResolvedValue([]);
      (getLanesForEvent as jest.Mock).mockResolvedValue([]);

      const result = await getPublicBracket(eventId);

      expect(result.bracket.rounds).toHaveLength(1);
      expect(result.bracket.rounds[0].id).toBe(gfRound1Id);
      expect(result.bracket.matches).toHaveLength(1);
      expect(result.bracket.matches[0].id).toBe(1);
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

  describe('buildProgressionSourceMap', () => {
    it('should advance only grand final match #1 to reset round when consolation final exists', async () => {
      const context = {
        stage: {
          id: 1,
          type: 'double_elimination',
          settings: { consolationFinal: true, grandFinal: 'double' },
        },
        groups: [
          { id: 10, number: 1 },
          { id: 20, number: 2 },
          { id: 30, number: 3 },
        ],
        rounds: [
          { id: 301, group_id: 30, number: 1 },
          { id: 302, group_id: 30, number: 2 },
        ],
        matches: [
          { id: 1001, stage_id: 1, group_id: 30, round_id: 301, number: 1, status: 4, opponent1: null, opponent2: null },
          { id: 1002, stage_id: 1, group_id: 30, round_id: 301, number: 2, status: 4, opponent1: null, opponent2: null },
          { id: 1003, stage_id: 1, group_id: 30, round_id: 302, number: 1, status: 0, opponent1: null, opponent2: null },
        ],
      };

      const map = await buildProgressionSourceMap(context as never);
      const resetSources = map[1003];

      expect(resetSources).toBeDefined();
      const allResetSourceIds = Object.values(resetSources).map((source) => source.sourceMatchId);
      expect(allResetSourceIds).toContain(1001);
      expect(allResetSourceIds).not.toContain(1002);
    });
  });


});
