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
  updateMatchStatus: jest.fn(),
  getBracketStage: jest.fn(),
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
import { bracketStageExists } from '@/lib/repositories/bracket-repository';
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
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      });

      await expect(getBracket(eventId)).rejects.toThrow(NotFoundError);
      await expect(getBracket(eventId)).rejects.toThrow('Bracket not found for this event');
    });

    it('should throw NotFoundError when stage is null', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      await expect(getBracket(eventId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getReadyMatches', () => {
    const eventId = 'event-123';

    it('should throw NotFoundError when bracket not found', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      await expect(getReadyMatches(eventId)).rejects.toThrow(NotFoundError);
      await expect(getReadyMatches(eventId)).rejects.toThrow('Bracket not found');
    });
  });

  describe('assignLaneToMatch', () => {
    const eventId = 'event-123';
    const matchId = 1;
    const laneId = 'lane-123';

    it('should assign lane to match successfully', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: true, error: null });

      await expect(assignLaneToMatch(eventId, matchId, laneId)).resolves.not.toThrow();

      expect(mockSupabase.rpc).toHaveBeenCalledWith('assign_lane_to_match', {
        p_event_id: eventId,
        p_lane_id: laneId,
        p_match_id: matchId,
      });
    });

    it('should throw InternalError on RPC failure', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'RPC failed' } });

      await expect(assignLaneToMatch(eventId, matchId, laneId)).rejects.toThrow(
        InternalError
      );
    });

    it('should throw BadRequestError when lane not available', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: false, error: null });

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
  });

  describe('updateMatchResult', () => {
    const eventId = 'event-123';
    const matchId = 1;

    it('should throw NotFoundError when match not found', async () => {
      const queryBuilder = createMockQueryBuilder({
        data: null,
        error: { message: 'Not found' },
      });
      mockSupabase.from.mockReturnValue(queryBuilder);

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

      const queryBuilder = createMockQueryBuilder({ data: mockMatch, error: null });
      mockSupabase.from.mockReturnValue(queryBuilder);

      await expect(updateMatchResult(eventId, matchId, 5, 3)).rejects.toThrow(
        BadRequestError
      );
      await expect(updateMatchResult(eventId, matchId, 5, 3)).rejects.toThrow(
        'Match does not belong to this event'
      );
    });
  });
});
