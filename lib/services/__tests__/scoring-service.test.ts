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
  createMockEvent,
  createMockBracketMatch,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/supabase/privileged', () => ({
  _createPrivilegedClient: jest.fn(),
}));

jest.mock('@/lib/db/client', () => ({
  _getDb: jest.fn(),
}));

jest.mock('@/lib/services/lane', () => ({
  releaseLaneAndAutoAssignTx: jest.fn(),
}));

jest.mock('@/lib/repositories/team-repository', () => ({
  getPublicTeamFromParticipant: jest.fn(),
}));

jest.mock('@/lib/repositories/event-repository.db', () => ({
  getEventByAccessCode: jest.fn(),
  getEventAccess: jest.fn(),
  getEventBracketFrameCount: jest.fn(),
  getEventScoringConfig: jest.fn(),
}));

jest.mock('@/lib/repositories/lane-repository', () => ({
  getLaneLabelsForEvent: jest.fn(),
  getLanesForEvent: jest.fn(),
}));

jest.mock('@/lib/repositories/bracket-repository', () => ({
  getMatchesForScoringByEvent: jest.fn(),
  getMatchForScoringById: jest.fn(),
}));

jest.mock('@/lib/services/qualification', () => ({
  validateQualificationAccessCode: jest.fn(),
  getPlayersForQualification: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { _createPrivilegedClient } from '@/lib/supabase/privileged';
import { _getDb } from '@/lib/db/client';
import { getPublicTeamFromParticipant } from '@/lib/repositories/team-repository';
import {
  getEventAccess,
  getEventByAccessCode,
  getEventBracketFrameCount,
  getEventScoringConfig,
} from '@/lib/repositories/event-repository.db';
import { getLaneLabelsForEvent, getLanesForEvent } from '@/lib/repositories/lane-repository';
import {
  getMatchesForScoringByEvent,
  getMatchForScoringById,
} from '@/lib/repositories/bracket-repository';
import {
  validateQualificationAccessCode,
  getPlayersForQualification,
} from '@/lib/services/qualification';
import { calculatePoints } from '../scoring/points-calculator';
import {
  validateAccessCode,
  getMatchesForScoring,
  getMatchForScoring,
  getEventScoringContext,
  getPublicMatchDetails,
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
  const mockPg = {};

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    (_createPrivilegedClient as jest.Mock).mockReturnValue(mockSupabase);
    (_getDb as jest.Mock).mockReturnValue(mockPg);
  });

  it('does not query public match details when bracket visibility authorization fails', async () => {
    const eventId = '00000000-0000-4000-8000-000000000001';
    (getEventAccess as jest.Mock).mockResolvedValue(null);
    await expect(getPublicMatchDetails(eventId, 1)).rejects.toThrow(NotFoundError);
    expect(getMatchForScoringById).not.toHaveBeenCalled();
    expect(getEventBracketFrameCount).not.toHaveBeenCalled();
    expect(getEventScoringConfig).not.toHaveBeenCalled();
  });

  describe('getEventScoringContext', () => {
    const accessCode = 'ABC123';

    it('should return qualification context when event is pre-bracket and qualification is enabled', async () => {
      (getEventByAccessCode as jest.Mock).mockResolvedValue({
        id: 'event-123',
        status: 'pre-bracket',
        qualification_round_enabled: true,
      });

      const mockEvent = { id: 'event-123', status: 'pre-bracket' };
      const mockPlayers = [{ event_player_id: 'ep-1' }];
      (validateQualificationAccessCode as jest.Mock).mockResolvedValue(mockEvent);
      (getPlayersForQualification as jest.Mock).mockResolvedValue(mockPlayers);

      const result = await getEventScoringContext(accessCode);

      expect(result).toEqual({
        mode: 'qualification',
        event: mockEvent,
        players: mockPlayers,
      });
      expect(getEventByAccessCode).toHaveBeenCalledWith(mockPg, accessCode.toLowerCase());
    });

    it('should return bracket context when event is in bracket status', async () => {
      (getEventByAccessCode as jest.Mock).mockResolvedValue({
        id: 'event-123',
        status: 'bracket',
        qualification_round_enabled: false,
      });

      const mockEvent = { id: 'event-123', status: 'bracket' };
      (getEventByAccessCode as jest.Mock).mockResolvedValue(mockEvent);
      (getLanesForEvent as jest.Mock).mockResolvedValue([]);
      (getMatchesForScoringByEvent as jest.Mock).mockResolvedValue([]);
      (getPublicTeamFromParticipant as jest.Mock).mockResolvedValue({});

      const result = await getEventScoringContext(accessCode);

      expect(result.mode).toBe('bracket');
      expect(result.event).toEqual(mockEvent);
      expect(Array.isArray(result.matches)).toBe(true);
    });

    it('should throw NotFoundError for invalid access code', async () => {
      (getEventByAccessCode as jest.Mock).mockResolvedValue(null);

      await expect(getEventScoringContext('INVALID')).rejects.toThrow(NotFoundError);
    });

    it('should throw BadRequestError for event not in scoreable state', async () => {
      (getEventByAccessCode as jest.Mock).mockResolvedValue({
        id: 'event-123',
        status: 'created',
        qualification_round_enabled: false,
      });

      await expect(getEventScoringContext(accessCode)).rejects.toThrow(BadRequestError);
      await expect(getEventScoringContext(accessCode)).rejects.toThrow(
        'Event is not accepting scores at this time'
      );
    });

    it('should handle access code case-insensitively', async () => {
      (getEventByAccessCode as jest.Mock).mockResolvedValue({
        id: 'event-123',
        status: 'bracket',
        qualification_round_enabled: false,
      });

      const mockEvent = { id: 'event-123', status: 'bracket' };
      (getEventByAccessCode as jest.Mock).mockResolvedValue(mockEvent);
      (getLanesForEvent as jest.Mock).mockResolvedValue([]);
      (getMatchesForScoringByEvent as jest.Mock).mockResolvedValue([]);
      (getPublicTeamFromParticipant as jest.Mock).mockResolvedValue({});

      // Codes are normalized to lower case and matched exactly
      await getEventScoringContext('ABC123');

      expect(getEventByAccessCode).toHaveBeenCalledWith(mockPg, 'abc123');
    });

    it('should trim whitespace from access code', async () => {
      (getEventByAccessCode as jest.Mock).mockResolvedValue({
        id: 'event-123',
        status: 'bracket',
        qualification_round_enabled: false,
      });

      const mockEvent = { id: 'event-123', status: 'bracket' };
      (getEventByAccessCode as jest.Mock).mockResolvedValue(mockEvent);
      (getLanesForEvent as jest.Mock).mockResolvedValue([]);
      (getMatchesForScoringByEvent as jest.Mock).mockResolvedValue([]);
      (getPublicTeamFromParticipant as jest.Mock).mockResolvedValue({});

      // Pass code with spaces
      await getEventScoringContext('  ABC123  ');

      // Verify repo was called with trimmed code
      expect(getEventByAccessCode).toHaveBeenCalledWith(mockPg, 'abc123');
    });
  });

  describe('validateAccessCode', () => {
    it('should return event info for valid access code', async () => {
      const mockEvent = createMockEvent({
        id: 'event-123',
        status: 'bracket',
        access_code: 'ABC123',
      });
      (getEventByAccessCode as jest.Mock).mockResolvedValue(mockEvent);

      const result = await validateAccessCode('ABC123');

      expect(result).toMatchObject({ id: mockEvent.id, status: 'bracket' });
      expect(result).not.toHaveProperty('access_code');
      expect(getEventByAccessCode).toHaveBeenCalledWith(mockPg, 'abc123');
    });

    it('should throw NotFoundError for invalid access code', async () => {
      (getEventByAccessCode as jest.Mock).mockResolvedValue(null);

      await expect(validateAccessCode('INVALID')).rejects.toThrow(NotFoundError);
      await expect(validateAccessCode('INVALID')).rejects.toThrow(
        'Invalid access code or event is not in bracket play'
      );
    });

    it('should throw InternalError on database error', async () => {
      (getEventByAccessCode as jest.Mock).mockRejectedValue(
        new InternalError('Failed to fetch event by access code: DB error')
      );

      await expect(validateAccessCode('ABC123')).rejects.toThrow(InternalError);
      await expect(validateAccessCode('ABC123')).rejects.toThrow(
        'Failed to fetch event by access code'
      );
    });

    it('should trim whitespace from access code', async () => {
      const mockEvent = createMockEvent({ status: 'bracket' });
      (getEventByAccessCode as jest.Mock).mockResolvedValue(mockEvent);

      await validateAccessCode('  ABC123  ');

      expect(getEventByAccessCode).toHaveBeenCalledWith(mockPg, 'abc123');
    });
  });

  describe('getMatchesForScoring', () => {
    const accessCode = 'ABC123';

    beforeEach(() => {
      // Mock successful access code validation
      const mockEvent = createMockEvent({ id: 'event-123', status: 'bracket' });
      (getEventByAccessCode as jest.Mock).mockResolvedValue(mockEvent);

      // Mock lanes query
      (getLaneLabelsForEvent as jest.Mock).mockResolvedValue({ 'lane-1': 'Lane 1' });

      // Mock bracket matches query - empty by default
      (getMatchesForScoringByEvent as jest.Mock).mockResolvedValue([]);
    });

    it('should return empty array when no matches found', async () => {
      const result = await getMatchesForScoring(accessCode);

      expect(result).toEqual([]);
    });

    it('should return matches with team info', async () => {
      const mockMatch = createMockBracketMatch({
        id: 1,
        status: 2,
        lane_id: 'lane-1',
        opponent1: { id: 1, score: 5 },
        opponent2: { id: 2, score: 3 },
      });

      (getMatchesForScoringByEvent as jest.Mock).mockResolvedValue([{ ...mockMatch, frames: [] }]);

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
      (getMatchesForScoringByEvent as jest.Mock).mockRejectedValue(
        new InternalError('Failed to fetch matches for scoring: DB error')
      );

      await expect(getMatchesForScoring(accessCode)).rejects.toThrow(InternalError);
    });
  });

  describe('getMatchForScoring', () => {
    const accessCode = 'ABC123';
    const bracketMatchId = 1;

    beforeEach(() => {
      const mockEvent = createMockEvent({ id: 'event-123', status: 'bracket' });
      (getEventByAccessCode as jest.Mock).mockResolvedValue(mockEvent);
      (getLaneLabelsForEvent as jest.Mock).mockResolvedValue({ 'lane-1': 'Lane 1' });
    });

    it('should return match details', async () => {
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

      (getMatchForScoringById as jest.Mock).mockResolvedValue(mockMatch);

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
      (getMatchForScoringById as jest.Mock).mockResolvedValue(null);

      await expect(getMatchForScoring(accessCode, bracketMatchId)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw ForbiddenError when match belongs to different event', async () => {
      const mockMatch = {
        id: bracketMatchId,
        event_id: 'different-event',
        opponent1: { id: 1 },
        opponent2: { id: 2 },
        frames: [],
      };
      (getMatchForScoringById as jest.Mock).mockResolvedValue(mockMatch);

      await expect(getMatchForScoring(accessCode, bracketMatchId)).rejects.toThrow(
        ForbiddenError
      );
      await expect(getMatchForScoring(accessCode, bracketMatchId)).rejects.toThrow(
        'Match does not belong to this event'
      );
    });

    it('should propagate InternalError when repository throws database error', async () => {
      (getMatchForScoringById as jest.Mock).mockRejectedValue(
        new InternalError('Failed to fetch bracket match: DB error')
      );

      await expect(getMatchForScoring(accessCode, bracketMatchId)).rejects.toThrow(
        InternalError
      );
      await expect(getMatchForScoring(accessCode, bracketMatchId)).rejects.toThrow(
        'Failed to fetch bracket match'
      );
    });
  });


});
