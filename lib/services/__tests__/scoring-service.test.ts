/**
 * Scoring Service Tests
 *
 * Tests for scoring functions:
 * - calculatePoints()
 * - validateAccessCode()
 * - getMatchesForScoring()
 * - getMatchForScoring()
 * - recordScore()
 * - recordScoreAndGetMatch()
 * - completeMatchPublic()
 */

import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  InternalError,
} from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockQueryBuilder,
  createMockEvent,
  createMockBracketMatch,
  createMockMatchFrame,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/services/lane', () => ({
  releaseAndReassignLanePublic: jest.fn(),
}));

jest.mock('@/lib/repositories/frame-repository', () => ({
  getOrCreateFrame: jest.fn(),
}));

jest.mock('@/lib/repositories/team-repository', () => ({
  getPublicTeamFromParticipant: jest.fn(),
  getTeamIdsFromParticipants: jest.fn(),
  verifyPlayerInTeams: jest.fn(),
}));

jest.mock('@/lib/services/scoring/match-completion', () => ({
  completeMatch: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { getOrCreateFrame } from '@/lib/repositories/frame-repository';
import {
  getPublicTeamFromParticipant,
  getTeamIdsFromParticipants,
  verifyPlayerInTeams,
} from '@/lib/repositories/team-repository';
import { calculatePoints } from '../scoring/points-calculator';
import {
  validateAccessCode,
  getMatchesForScoring,
  getMatchForScoring,
  recordScore,
  completeMatchPublic,
} from '../scoring/public-scoring';

describe('Points Calculator', () => {
  describe('calculatePoints', () => {
    it('should return putts made when bonus is disabled', () => {
      expect(calculatePoints(0, false)).toBe(0);
      expect(calculatePoints(1, false)).toBe(1);
      expect(calculatePoints(2, false)).toBe(2);
      expect(calculatePoints(3, false)).toBe(3);
    });

    it('should return putts made when bonus is enabled but not all putts made', () => {
      expect(calculatePoints(0, true)).toBe(0);
      expect(calculatePoints(1, true)).toBe(1);
      expect(calculatePoints(2, true)).toBe(2);
    });

    it('should return 4 points when all 3 putts made and bonus enabled', () => {
      expect(calculatePoints(3, true)).toBe(4);
    });

    it('should return 3 points when all 3 putts made but bonus disabled', () => {
      expect(calculatePoints(3, false)).toBe(3);
    });
  });
});

describe('Scoring Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('validateAccessCode', () => {
    it('should return event info for valid access code', async () => {
      const mockEvent = createMockEvent({
        id: 'event-123',
        status: 'bracket',
        access_code: 'ABC123',
      });

      const queryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });
      mockSupabase.from.mockReturnValue(queryBuilder);

      const result = await validateAccessCode('ABC123');

      expect(result).toEqual(mockEvent);
      expect(mockSupabase.from).toHaveBeenCalledWith('events');
      expect(queryBuilder.eq).toHaveBeenCalledWith('access_code', 'ABC123');
      expect(queryBuilder.eq).toHaveBeenCalledWith('status', 'bracket');
    });

    it('should throw NotFoundError for invalid access code', async () => {
      const queryBuilder = createMockQueryBuilder({ data: null, error: null });
      mockSupabase.from.mockReturnValue(queryBuilder);

      await expect(validateAccessCode('INVALID')).rejects.toThrow(NotFoundError);
      await expect(validateAccessCode('INVALID')).rejects.toThrow(
        'Invalid access code or event is not in bracket play'
      );
    });

    it('should throw InternalError on database error', async () => {
      const queryBuilder = createMockQueryBuilder({
        data: null,
        error: { message: 'DB error' },
      });
      mockSupabase.from.mockReturnValue(queryBuilder);

      await expect(validateAccessCode('ABC123')).rejects.toThrow(InternalError);
      await expect(validateAccessCode('ABC123')).rejects.toThrow(
        'Failed to validate access code'
      );
    });

    it('should accept optional supabase client', async () => {
      const existingClient = createMockSupabaseClient();
      const mockEvent = createMockEvent({ status: 'bracket' });

      const queryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });
      existingClient.from.mockReturnValue(queryBuilder);

      const result = await validateAccessCode('ABC123', existingClient as MockSupabaseClient);

      expect(result).toEqual(mockEvent);
      expect(createClient).not.toHaveBeenCalled();
    });
  });

  describe('getMatchesForScoring', () => {
    const accessCode = 'ABC123';

    beforeEach(() => {
      // Mock successful access code validation
      const mockEvent = createMockEvent({ id: 'event-123', status: 'bracket' });
      const eventQueryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });

      // Mock lanes query
      const lanesQueryBuilder = createMockQueryBuilder();
      lanesQueryBuilder.select.mockReturnThis();
      lanesQueryBuilder.eq.mockResolvedValue({
        data: [{ id: 'lane-1', label: 'Lane 1' }],
        error: null,
      });

      // Mock bracket matches query
      const matchesQueryBuilder = createMockQueryBuilder();
      matchesQueryBuilder.select.mockReturnThis();
      matchesQueryBuilder.eq.mockReturnThis();
      matchesQueryBuilder.in.mockReturnThis();
      matchesQueryBuilder.not.mockResolvedValue({
        data: [],
        error: null,
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'events') return eventQueryBuilder;
        if (table === 'lanes') return lanesQueryBuilder;
        if (table === 'bracket_match') return matchesQueryBuilder;
        return createMockQueryBuilder();
      });
    });

    it('should return empty array when no matches found', async () => {
      const result = await getMatchesForScoring(accessCode);

      expect(result).toEqual([]);
    });

    it('should return matches with team info', async () => {
      const mockEvent = createMockEvent({ id: 'event-123', status: 'bracket' });
      const eventQueryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });

      const lanesQueryBuilder = createMockQueryBuilder();
      lanesQueryBuilder.select.mockReturnThis();
      lanesQueryBuilder.eq.mockResolvedValue({
        data: [{ id: 'lane-1', label: 'Lane 1' }],
        error: null,
      });

      const mockMatch = createMockBracketMatch({
        id: 1,
        status: 2,
        lane_id: 'lane-1',
        opponent1: { id: 1, score: 5 },
        opponent2: { id: 2, score: 3 },
      });

      const matchesQueryBuilder = createMockQueryBuilder();
      matchesQueryBuilder.select.mockReturnThis();
      matchesQueryBuilder.eq.mockReturnThis();
      matchesQueryBuilder.in.mockReturnThis();
      matchesQueryBuilder.not.mockResolvedValue({
        data: [{ ...mockMatch, frames: [] }],
        error: null,
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'events') return eventQueryBuilder;
        if (table === 'lanes') return lanesQueryBuilder;
        if (table === 'bracket_match') return matchesQueryBuilder;
        return createMockQueryBuilder();
      });

      const mockTeam1 = { id: 'team-1', pool_combo: 'Team 1', players: [] };
      const mockTeam2 = { id: 'team-2', pool_combo: 'Team 2', players: [] };

      (getPublicTeamFromParticipant as jest.Mock)
        .mockResolvedValueOnce(mockTeam1)
        .mockResolvedValueOnce(mockTeam2);

      const result = await getMatchesForScoring(accessCode);

      expect(result).toHaveLength(1);
      expect(result[0].team_one).toEqual(mockTeam1);
      expect(result[0].team_two).toEqual(mockTeam2);
      expect(result[0].lane_label).toBe('Lane 1');
    });

    it('should throw InternalError on database error', async () => {
      const mockEvent = createMockEvent({ id: 'event-123', status: 'bracket' });
      const eventQueryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });

      const lanesQueryBuilder = createMockQueryBuilder();
      lanesQueryBuilder.select.mockReturnThis();
      lanesQueryBuilder.eq.mockResolvedValue({ data: [], error: null });

      const matchesQueryBuilder = createMockQueryBuilder();
      matchesQueryBuilder.select.mockReturnThis();
      matchesQueryBuilder.eq.mockReturnThis();
      matchesQueryBuilder.in.mockReturnThis();
      matchesQueryBuilder.not.mockResolvedValue({
        data: null,
        error: { message: 'DB error' },
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'events') return eventQueryBuilder;
        if (table === 'lanes') return lanesQueryBuilder;
        if (table === 'bracket_match') return matchesQueryBuilder;
        return createMockQueryBuilder();
      });

      await expect(getMatchesForScoring(accessCode)).rejects.toThrow(InternalError);
    });
  });

  describe('getMatchForScoring', () => {
    const accessCode = 'ABC123';
    const bracketMatchId = 1;

    it('should return match details', async () => {
      const mockEvent = createMockEvent({ id: 'event-123', status: 'bracket' });
      const eventQueryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });

      const lanesQueryBuilder = createMockQueryBuilder();
      lanesQueryBuilder.select.mockReturnThis();
      lanesQueryBuilder.eq.mockResolvedValue({
        data: [{ id: 'lane-1', label: 'Lane 1' }],
        error: null,
      });

      const mockMatch = {
        id: bracketMatchId,
        status: 3,
        round_id: 1,
        number: 1,
        lane_id: 'lane-1',
        event_id: 'event-123',
        opponent1: { id: 1, score: 5 },
        opponent2: { id: 2, score: 3 },
        frames: [],
      };

      const matchQueryBuilder = createMockQueryBuilder({ data: mockMatch, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'events') return eventQueryBuilder;
        if (table === 'lanes') return lanesQueryBuilder;
        if (table === 'bracket_match') return matchQueryBuilder;
        return createMockQueryBuilder();
      });

      const mockTeam1 = { id: 'team-1', pool_combo: 'Team 1', players: [] };
      const mockTeam2 = { id: 'team-2', pool_combo: 'Team 2', players: [] };

      (getPublicTeamFromParticipant as jest.Mock)
        .mockResolvedValueOnce(mockTeam1)
        .mockResolvedValueOnce(mockTeam2);

      const result = await getMatchForScoring(accessCode, bracketMatchId);

      expect(result.id).toBe(bracketMatchId);
      expect(result.team_one).toEqual(mockTeam1);
      expect(result.team_two).toEqual(mockTeam2);
      expect(result.team_one_score).toBe(5);
      expect(result.team_two_score).toBe(3);
    });

    it('should throw NotFoundError when match not found', async () => {
      const mockEvent = createMockEvent({ id: 'event-123', status: 'bracket' });
      const eventQueryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });

      const lanesQueryBuilder = createMockQueryBuilder();
      lanesQueryBuilder.select.mockReturnThis();
      lanesQueryBuilder.eq.mockResolvedValue({ data: [], error: null });

      const matchQueryBuilder = createMockQueryBuilder({
        data: null,
        error: { message: 'Not found' },
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'events') return eventQueryBuilder;
        if (table === 'lanes') return lanesQueryBuilder;
        if (table === 'bracket_match') return matchQueryBuilder;
        return createMockQueryBuilder();
      });

      await expect(getMatchForScoring(accessCode, bracketMatchId)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw ForbiddenError when match belongs to different event', async () => {
      const mockEvent = createMockEvent({ id: 'event-123', status: 'bracket' });
      const eventQueryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });

      const lanesQueryBuilder = createMockQueryBuilder();
      lanesQueryBuilder.select.mockReturnThis();
      lanesQueryBuilder.eq.mockResolvedValue({ data: [], error: null });

      const mockMatch = {
        id: bracketMatchId,
        event_id: 'different-event',
        opponent1: { id: 1 },
        opponent2: { id: 2 },
        frames: [],
      };
      const matchQueryBuilder = createMockQueryBuilder({ data: mockMatch, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'events') return eventQueryBuilder;
        if (table === 'lanes') return lanesQueryBuilder;
        if (table === 'bracket_match') return matchQueryBuilder;
        return createMockQueryBuilder();
      });

      await expect(getMatchForScoring(accessCode, bracketMatchId)).rejects.toThrow(
        ForbiddenError
      );
      await expect(getMatchForScoring(accessCode, bracketMatchId)).rejects.toThrow(
        'Match does not belong to this event'
      );
    });
  });

  describe('recordScore', () => {
    const accessCode = 'ABC123';
    const bracketMatchId = 1;
    const frameNumber = 1;
    const eventPlayerId = 'ep-123';
    const puttsMade = 2;

    beforeEach(() => {
      // Mock event validation
      const mockEvent = createMockEvent({
        id: 'event-123',
        status: 'bracket',
        bonus_point_enabled: true,
      });
      const eventQueryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });

      // Mock bracket match query
      const mockMatch = createMockBracketMatch({
        id: bracketMatchId,
        event_id: 'event-123',
        status: 2,
      });
      const matchQueryBuilder = createMockQueryBuilder({ data: mockMatch, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'events') return eventQueryBuilder;
        if (table === 'bracket_match') return matchQueryBuilder;
        return createMockQueryBuilder();
      });

      // Mock team verification
      (getTeamIdsFromParticipants as jest.Mock).mockResolvedValue(['team-1', 'team-2']);
      (verifyPlayerInTeams as jest.Mock).mockResolvedValue(true);

      // Mock frame creation
      (getOrCreateFrame as jest.Mock).mockResolvedValue(
        createMockMatchFrame({ id: 'frame-123' })
      );

      // Mock RPC
      mockSupabase.rpc.mockResolvedValue({ error: null });
    });

    it('should record score successfully', async () => {
      await recordScore(accessCode, bracketMatchId, frameNumber, eventPlayerId, puttsMade);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('upsert_frame_result_atomic', {
        p_match_frame_id: 'frame-123',
        p_event_player_id: eventPlayerId,
        p_bracket_match_id: bracketMatchId,
        p_putts_made: puttsMade,
        p_points_earned: 2, // Standard scoring
      });
    });

    it('should throw BadRequestError for invalid putts (negative)', async () => {
      await expect(
        recordScore(accessCode, bracketMatchId, frameNumber, eventPlayerId, -1)
      ).rejects.toThrow(BadRequestError);
      await expect(
        recordScore(accessCode, bracketMatchId, frameNumber, eventPlayerId, -1)
      ).rejects.toThrow('Putts must be between 0 and 3');
    });

    it('should throw BadRequestError for invalid putts (> 3)', async () => {
      await expect(
        recordScore(accessCode, bracketMatchId, frameNumber, eventPlayerId, 4)
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw BadRequestError when match is already completed', async () => {
      const mockEvent = createMockEvent({ id: 'event-123', status: 'bracket' });
      const eventQueryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });

      const mockMatch = createMockBracketMatch({
        id: bracketMatchId,
        event_id: 'event-123',
        status: 4, // Completed
      });
      const matchQueryBuilder = createMockQueryBuilder({ data: mockMatch, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'events') return eventQueryBuilder;
        if (table === 'bracket_match') return matchQueryBuilder;
        return createMockQueryBuilder();
      });

      await expect(
        recordScore(accessCode, bracketMatchId, frameNumber, eventPlayerId, puttsMade)
      ).rejects.toThrow(BadRequestError);
      await expect(
        recordScore(accessCode, bracketMatchId, frameNumber, eventPlayerId, puttsMade)
      ).rejects.toThrow('Match is already completed');
    });

    it('should throw BadRequestError when player is not in match', async () => {
      (verifyPlayerInTeams as jest.Mock).mockResolvedValue(false);

      await expect(
        recordScore(accessCode, bracketMatchId, frameNumber, eventPlayerId, puttsMade)
      ).rejects.toThrow(BadRequestError);
      await expect(
        recordScore(accessCode, bracketMatchId, frameNumber, eventPlayerId, puttsMade)
      ).rejects.toThrow('Player is not in this match');
    });

    it('should throw InternalError when RPC fails', async () => {
      mockSupabase.rpc.mockResolvedValue({ error: { message: 'RPC failed' } });

      await expect(
        recordScore(accessCode, bracketMatchId, frameNumber, eventPlayerId, puttsMade)
      ).rejects.toThrow(InternalError);
    });

    it('should update match status from Ready to Running', async () => {
      const mockEvent = createMockEvent({ id: 'event-123', status: 'bracket' });
      const eventQueryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });

      const mockMatch = createMockBracketMatch({
        id: bracketMatchId,
        event_id: 'event-123',
        status: 2, // Ready
      });
      const matchQueryBuilder = createMockQueryBuilder({ data: mockMatch, error: null });
      matchQueryBuilder.update = jest.fn().mockReturnThis();

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'events') return eventQueryBuilder;
        if (table === 'bracket_match') return matchQueryBuilder;
        return createMockQueryBuilder();
      });

      await recordScore(accessCode, bracketMatchId, frameNumber, eventPlayerId, puttsMade);

      expect(matchQueryBuilder.update).toHaveBeenCalledWith({ status: 3 });
    });
  });

  describe('completeMatchPublic', () => {
    const accessCode = 'ABC123';
    const bracketMatchId = 1;

    it('should throw BadRequestError when scores are tied', async () => {
      const mockEvent = createMockEvent({ id: 'event-123', status: 'bracket' });
      const eventQueryBuilder = createMockQueryBuilder({ data: mockEvent, error: null });

      const lanesQueryBuilder = createMockQueryBuilder();
      lanesQueryBuilder.select.mockReturnThis();
      lanesQueryBuilder.eq.mockResolvedValue({ data: [], error: null });

      const mockMatch = {
        id: bracketMatchId,
        event_id: 'event-123',
        status: 3,
        round_id: 1,
        number: 1,
        lane_id: null,
        opponent1: { id: 1, score: 5 },
        opponent2: { id: 2, score: 5 }, // Tied
        frames: [],
      };
      const matchQueryBuilder = createMockQueryBuilder({ data: mockMatch, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'events') return eventQueryBuilder;
        if (table === 'lanes') return lanesQueryBuilder;
        if (table === 'bracket_match') return matchQueryBuilder;
        return createMockQueryBuilder();
      });

      const mockTeam = { id: 'team-1', pool_combo: 'Team', players: [] };
      (getPublicTeamFromParticipant as jest.Mock).mockResolvedValue(mockTeam);

      await expect(completeMatchPublic(accessCode, bracketMatchId)).rejects.toThrow(
        BadRequestError
      );
      await expect(completeMatchPublic(accessCode, bracketMatchId)).rejects.toThrow(
        'Match cannot be completed with a tied score'
      );
    });
  });
});
