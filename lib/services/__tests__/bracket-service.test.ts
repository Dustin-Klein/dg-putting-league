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
 */

import {
  BadRequestError,
  NotFoundError,
  InternalError,
} from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockQueryBuilder,
  createMockEventWithDetails,
  createMockTeam,
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
}));

jest.mock('@/lib/repositories/event-repository', () => ({
  getEventById: jest.fn(),
}));

jest.mock('brackets-manager', () => ({
  BracketsManager: jest.fn().mockImplementation(() => ({
    create: {
      stage: jest.fn(),
    },
    update: {
      match: jest.fn(),
    },
  })),
}));

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
} from '@/lib/repositories/bracket-repository';
import {
  createBracket,
  getBracket,
  updateMatchResult,
  getReadyMatches,
  assignLaneToMatch,
  bracketExists,
} from '../bracket/bracket-service';

describe('Bracket Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireEventAdmin as jest.Mock).mockResolvedValue({ supabase: mockSupabase });
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
});
