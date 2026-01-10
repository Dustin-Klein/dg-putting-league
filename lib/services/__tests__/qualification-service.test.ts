/**
 * Qualification Service Tests
 *
 * Tests for qualification scoring functions:
 * - validateQualificationAccessCode()
 * - getPlayersForQualification()
 * - getPlayerQualificationData()
 * - recordQualificationScore()
 * - getEventQualificationStatus()
 * - getBatchPlayerQualificationData()
 */

import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockEvent,
  createMockEventPlayer,
  createMockQualificationRound,
  createMockQualificationFrame,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/repositories/event-repository', () => ({
  getEventByAccessCodeForQualification: jest.fn(),
}));

jest.mock('@/lib/repositories/qualification-repository', () => ({
  getOrCreateQualificationRound: jest.fn(),
  getPaidEventPlayers: jest.fn(),
  getQualificationFrameAggregations: jest.fn(),
  getPlayerQualificationFrames: jest.fn(),
  recordQualificationFrame: jest.fn(),
  updateQualificationRoundStatus: jest.fn(),
  getQualificationRoundFull: jest.fn(),
  getEventPlayersQualificationStatus: jest.fn(),
  getQualificationFramesBulk: jest.fn(),
}));

jest.mock('@/lib/repositories/event-player-repository', () => ({
  getEventPlayer: jest.fn(),
  getEventPlayersBulk: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import * as eventRepo from '@/lib/repositories/event-repository';
import * as qualificationRepo from '@/lib/repositories/qualification-repository';
import * as eventPlayerRepo from '@/lib/repositories/event-player-repository';
import {
  validateQualificationAccessCode,
  getPlayersForQualification,
  getPlayerQualificationData,
  recordQualificationScore,
  getEventQualificationStatus,
  getBatchPlayerQualificationData,
} from '../qualification/qualification-service';

describe('Qualification Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('validateQualificationAccessCode', () => {
    it('should return event info for valid access code', async () => {
      const mockEvent = createMockEvent({
        id: 'event-123',
        status: 'pre-bracket',
        qualification_round_enabled: true,
      });

      (eventRepo.getEventByAccessCodeForQualification as jest.Mock).mockResolvedValue(
        mockEvent
      );

      const result = await validateQualificationAccessCode('ABC123');

      expect(result).toEqual(mockEvent);
    });

    it('should throw NotFoundError for invalid access code', async () => {
      (eventRepo.getEventByAccessCodeForQualification as jest.Mock).mockResolvedValue(null);

      await expect(validateQualificationAccessCode('INVALID')).rejects.toThrow(
        NotFoundError
      );
      await expect(validateQualificationAccessCode('INVALID')).rejects.toThrow(
        'Invalid access code or event is not accepting qualification scores'
      );
    });
  });

  describe('getPlayersForQualification', () => {
    const accessCode = 'ABC123';

    it('should return players with qualification status', async () => {
      const mockEvent = createMockEvent({
        id: 'event-123',
        qualification_round_enabled: true,
      });
      const mockRound = createMockQualificationRound({ frame_count: 10 });
      const mockPlayers = [
        {
          id: 'ep-1',
          player_id: 'p-1',
          player: {
            full_name: 'Player One',
            nickname: 'P1',
            player_number: 1,
          },
        },
        {
          id: 'ep-2',
          player_id: 'p-2',
          player: {
            full_name: 'Player Two',
            nickname: null,
            player_number: 2,
          },
        },
      ];

      const frameAggregations = {
        'ep-1': { count: 10, totalPoints: 25 },
        'ep-2': { count: 5, totalPoints: 12 },
      };

      (eventRepo.getEventByAccessCodeForQualification as jest.Mock).mockResolvedValue(
        mockEvent
      );
      (qualificationRepo.getOrCreateQualificationRound as jest.Mock).mockResolvedValue(
        mockRound
      );
      (qualificationRepo.getPaidEventPlayers as jest.Mock).mockResolvedValue(mockPlayers);
      (qualificationRepo.getQualificationFrameAggregations as jest.Mock).mockResolvedValue(
        frameAggregations
      );

      const result = await getPlayersForQualification(accessCode);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        event_player_id: 'ep-1',
        full_name: 'Player One',
        frames_completed: 10,
        total_frames_required: 10,
        total_points: 25,
        is_complete: true,
      });
      expect(result[1]).toMatchObject({
        event_player_id: 'ep-2',
        frames_completed: 5,
        is_complete: false,
      });
    });

    it('should handle players with no frames', async () => {
      const mockEvent = createMockEvent({ id: 'event-123' });
      const mockRound = createMockQualificationRound({ frame_count: 10 });
      const mockPlayers = [
        {
          id: 'ep-1',
          player_id: 'p-1',
          player: { full_name: 'Player One', nickname: null, player_number: null },
        },
      ];

      (eventRepo.getEventByAccessCodeForQualification as jest.Mock).mockResolvedValue(
        mockEvent
      );
      (qualificationRepo.getOrCreateQualificationRound as jest.Mock).mockResolvedValue(
        mockRound
      );
      (qualificationRepo.getPaidEventPlayers as jest.Mock).mockResolvedValue(mockPlayers);
      (qualificationRepo.getQualificationFrameAggregations as jest.Mock).mockResolvedValue(
        {}
      );

      const result = await getPlayersForQualification(accessCode);

      expect(result[0].frames_completed).toBe(0);
      expect(result[0].total_points).toBe(0);
      expect(result[0].is_complete).toBe(false);
    });
  });

  describe('getPlayerQualificationData', () => {
    const accessCode = 'ABC123';
    const eventPlayerId = 'ep-123';

    it('should return player qualification data', async () => {
      const mockEvent = createMockEvent({ id: 'event-123' });
      const mockEventPlayer = createMockEventPlayer({
        id: eventPlayerId,
        event_id: 'event-123',
        has_paid: true,
      });
      const mockRound = createMockQualificationRound({ frame_count: 10 });
      const mockFrames = [
        createMockQualificationFrame({ frame_number: 1, points_earned: 3 }),
        createMockQualificationFrame({ frame_number: 2, points_earned: 2 }),
      ];

      (eventRepo.getEventByAccessCodeForQualification as jest.Mock).mockResolvedValue(
        mockEvent
      );
      (eventPlayerRepo.getEventPlayer as jest.Mock).mockResolvedValue(mockEventPlayer);
      (qualificationRepo.getOrCreateQualificationRound as jest.Mock).mockResolvedValue(
        mockRound
      );
      (qualificationRepo.getPlayerQualificationFrames as jest.Mock).mockResolvedValue(
        mockFrames
      );

      const result = await getPlayerQualificationData(accessCode, eventPlayerId);

      expect(result.event).toEqual(mockEvent);
      expect(result.player.frames_completed).toBe(2);
      expect(result.player.total_points).toBe(5);
      expect(result.player.is_complete).toBe(false);
      expect(result.frames).toEqual(mockFrames);
      expect(result.nextFrameNumber).toBe(3);
    });

    it('should throw ForbiddenError when player belongs to different event', async () => {
      const mockEvent = createMockEvent({ id: 'event-123' });
      const mockEventPlayer = createMockEventPlayer({
        id: eventPlayerId,
        event_id: 'different-event',
        has_paid: true,
      });

      (eventRepo.getEventByAccessCodeForQualification as jest.Mock).mockResolvedValue(
        mockEvent
      );
      (eventPlayerRepo.getEventPlayer as jest.Mock).mockResolvedValue(mockEventPlayer);

      await expect(
        getPlayerQualificationData(accessCode, eventPlayerId)
      ).rejects.toThrow(ForbiddenError);
      await expect(
        getPlayerQualificationData(accessCode, eventPlayerId)
      ).rejects.toThrow('Player does not belong to this event');
    });

    it('should throw BadRequestError when player has not paid', async () => {
      const mockEvent = createMockEvent({ id: 'event-123' });
      const mockEventPlayer = createMockEventPlayer({
        id: eventPlayerId,
        event_id: 'event-123',
        has_paid: false,
      });

      (eventRepo.getEventByAccessCodeForQualification as jest.Mock).mockResolvedValue(
        mockEvent
      );
      (eventPlayerRepo.getEventPlayer as jest.Mock).mockResolvedValue(mockEventPlayer);

      await expect(
        getPlayerQualificationData(accessCode, eventPlayerId)
      ).rejects.toThrow(BadRequestError);
      await expect(
        getPlayerQualificationData(accessCode, eventPlayerId)
      ).rejects.toThrow('Player must be marked as paid');
    });
  });

  describe('recordQualificationScore', () => {
    const accessCode = 'ABC123';
    const eventPlayerId = 'ep-123';
    const frameNumber = 1;
    const puttsMade = 2;

    beforeEach(() => {
      const mockEvent = createMockEvent({
        id: 'event-123',
        bonus_point_enabled: true,
      });
      const mockEventPlayer = createMockEventPlayer({
        id: eventPlayerId,
        event_id: 'event-123',
        has_paid: true,
      });
      const mockRound = createMockQualificationRound({
        id: 'round-123',
        frame_count: 10,
        status: 'not_started',
      });

      (eventRepo.getEventByAccessCodeForQualification as jest.Mock).mockResolvedValue(
        mockEvent
      );
      (eventPlayerRepo.getEventPlayer as jest.Mock).mockResolvedValue(mockEventPlayer);
      (qualificationRepo.getOrCreateQualificationRound as jest.Mock).mockResolvedValue(
        mockRound
      );
      (qualificationRepo.getPlayerQualificationFrames as jest.Mock).mockResolvedValue([]);
    });

    it('should record qualification score successfully', async () => {
      const mockFrame = createMockQualificationFrame({
        frame_number: frameNumber,
        putts_made: puttsMade,
        points_earned: 2,
      });

      (qualificationRepo.recordQualificationFrame as jest.Mock).mockResolvedValue(
        mockFrame
      );
      (qualificationRepo.updateQualificationRoundStatus as jest.Mock).mockResolvedValue(
        undefined
      );

      const result = await recordQualificationScore(
        accessCode,
        eventPlayerId,
        frameNumber,
        puttsMade
      );

      expect(result.frame).toEqual(mockFrame);
      expect(qualificationRepo.recordQualificationFrame).toHaveBeenCalled();
      expect(qualificationRepo.updateQualificationRoundStatus).toHaveBeenCalledWith(
        mockSupabase,
        'round-123',
        'in_progress'
      );
    });

    it('should throw BadRequestError for invalid putts (negative)', async () => {
      await expect(
        recordQualificationScore(accessCode, eventPlayerId, frameNumber, -1)
      ).rejects.toThrow(BadRequestError);
      await expect(
        recordQualificationScore(accessCode, eventPlayerId, frameNumber, -1)
      ).rejects.toThrow('Putts must be between 0 and 3');
    });

    it('should throw BadRequestError for invalid putts (> 3)', async () => {
      await expect(
        recordQualificationScore(accessCode, eventPlayerId, frameNumber, 4)
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw BadRequestError when exceeding frame count', async () => {
      (qualificationRepo.getPlayerQualificationFrames as jest.Mock).mockResolvedValue([
        createMockQualificationFrame({ frame_number: 1 }),
        createMockQualificationFrame({ frame_number: 2 }),
        createMockQualificationFrame({ frame_number: 3 }),
        createMockQualificationFrame({ frame_number: 4 }),
        createMockQualificationFrame({ frame_number: 5 }),
        createMockQualificationFrame({ frame_number: 6 }),
        createMockQualificationFrame({ frame_number: 7 }),
        createMockQualificationFrame({ frame_number: 8 }),
        createMockQualificationFrame({ frame_number: 9 }),
        createMockQualificationFrame({ frame_number: 10 }),
      ]);

      await expect(
        recordQualificationScore(accessCode, eventPlayerId, 11, puttsMade)
      ).rejects.toThrow(BadRequestError);
      await expect(
        recordQualificationScore(accessCode, eventPlayerId, 11, puttsMade)
      ).rejects.toThrow('Player has already completed all 10 qualification frames');
    });

    it('should throw BadRequestError for invalid frame number', async () => {
      await expect(
        recordQualificationScore(accessCode, eventPlayerId, 0, puttsMade)
      ).rejects.toThrow(BadRequestError);
      await expect(
        recordQualificationScore(accessCode, eventPlayerId, 0, puttsMade)
      ).rejects.toThrow('Frame number must be between 1 and 10');
    });

    it('should allow updating existing frame', async () => {
      const existingFrame = createMockQualificationFrame({ frame_number: 1 });
      (qualificationRepo.getPlayerQualificationFrames as jest.Mock).mockResolvedValue([
        existingFrame,
      ]);

      const updatedFrame = createMockQualificationFrame({
        frame_number: 1,
        putts_made: 3,
        points_earned: 4,
      });
      (qualificationRepo.recordQualificationFrame as jest.Mock).mockResolvedValue(
        updatedFrame
      );

      const result = await recordQualificationScore(
        accessCode,
        eventPlayerId,
        1,
        3
      );

      expect(result.frame.putts_made).toBe(3);
    });

    it('should calculate bonus points correctly', async () => {
      const mockFrame = createMockQualificationFrame({
        frame_number: frameNumber,
        putts_made: 3,
        points_earned: 4, // Bonus enabled
      });

      (qualificationRepo.recordQualificationFrame as jest.Mock).mockResolvedValue(
        mockFrame
      );

      await recordQualificationScore(accessCode, eventPlayerId, frameNumber, 3);

      expect(qualificationRepo.recordQualificationFrame).toHaveBeenCalledWith(
        mockSupabase,
        expect.objectContaining({
          pointsEarned: 4, // 3 putts + bonus = 4 points
        })
      );
    });
  });

  describe('getEventQualificationStatus', () => {
    const eventId = 'event-123';

    it('should return qualification status', async () => {
      const mockRound = createMockQualificationRound({
        id: 'round-123',
        frame_count: 10,
        status: 'in_progress',
      });
      const mockPlayerStatus = [
        {
          event_player_id: 'ep-1',
          full_name: 'Player One',
          frames_completed: 10,
          is_complete: true,
        },
        {
          event_player_id: 'ep-2',
          full_name: 'Player Two',
          frames_completed: 5,
          is_complete: false,
        },
      ];

      (qualificationRepo.getQualificationRoundFull as jest.Mock).mockResolvedValue(
        mockRound
      );
      (qualificationRepo.getEventPlayersQualificationStatus as jest.Mock).mockResolvedValue(
        mockPlayerStatus
      );

      const result = await getEventQualificationStatus(eventId);

      expect(result.round).toEqual(mockRound);
      expect(result.players).toEqual(mockPlayerStatus);
      expect(result.allComplete).toBe(false);
    });

    it('should return allComplete true when all players finished', async () => {
      const mockRound = createMockQualificationRound({ status: 'in_progress' });
      const mockPlayerStatus = [
        { event_player_id: 'ep-1', is_complete: true },
        { event_player_id: 'ep-2', is_complete: true },
      ];

      (qualificationRepo.getQualificationRoundFull as jest.Mock).mockResolvedValue(
        mockRound
      );
      (qualificationRepo.getEventPlayersQualificationStatus as jest.Mock).mockResolvedValue(
        mockPlayerStatus
      );

      const result = await getEventQualificationStatus(eventId);

      expect(result.allComplete).toBe(true);
    });

    it('should return empty state when no qualification round', async () => {
      (qualificationRepo.getQualificationRoundFull as jest.Mock).mockResolvedValue(null);

      const result = await getEventQualificationStatus(eventId);

      expect(result.round).toBeNull();
      expect(result.players).toEqual([]);
      expect(result.allComplete).toBe(false);
    });
  });

  describe('getBatchPlayerQualificationData', () => {
    const accessCode = 'ABC123';
    const eventPlayerIds = ['ep-1', 'ep-2'];

    it('should return batch qualification data', async () => {
      const mockEvent = createMockEvent({ id: 'event-123' });
      const mockRound = createMockQualificationRound({
        id: 'round-123',
        frame_count: 10,
      });
      const mockEventPlayers = [
        createMockEventPlayer({
          id: 'ep-1',
          event_id: 'event-123',
          has_paid: true,
        }),
        createMockEventPlayer({
          id: 'ep-2',
          event_id: 'event-123',
          has_paid: true,
        }),
      ];

      const mockFramesByPlayer = {
        'ep-1': [
          createMockQualificationFrame({ frame_number: 1, points_earned: 3 }),
          createMockQualificationFrame({ frame_number: 2, points_earned: 2 }),
        ],
        'ep-2': [],
      };

      (eventRepo.getEventByAccessCodeForQualification as jest.Mock).mockResolvedValue(
        mockEvent
      );
      (qualificationRepo.getOrCreateQualificationRound as jest.Mock).mockResolvedValue(
        mockRound
      );
      (eventPlayerRepo.getEventPlayersBulk as jest.Mock).mockResolvedValue(
        mockEventPlayers
      );
      (qualificationRepo.getQualificationFramesBulk as jest.Mock).mockResolvedValue(
        mockFramesByPlayer
      );

      const result = await getBatchPlayerQualificationData(accessCode, eventPlayerIds);

      expect(result.event).toEqual(mockEvent);
      expect(result.round.id).toBe('round-123');
      expect(result.players).toHaveLength(2);
      expect(result.players[0].frames_completed).toBe(2);
      expect(result.players[0].total_points).toBe(5);
      expect(result.players[1].frames_completed).toBe(0);
    });

    it('should filter out invalid players', async () => {
      const mockEvent = createMockEvent({ id: 'event-123' });
      const mockRound = createMockQualificationRound({ frame_count: 10 });
      const mockEventPlayers = [
        createMockEventPlayer({
          id: 'ep-1',
          event_id: 'event-123',
          has_paid: true,
        }),
        createMockEventPlayer({
          id: 'ep-2',
          event_id: 'different-event', // Wrong event
          has_paid: true,
        }),
        createMockEventPlayer({
          id: 'ep-3',
          event_id: 'event-123',
          has_paid: false, // Not paid
        }),
      ];

      (eventRepo.getEventByAccessCodeForQualification as jest.Mock).mockResolvedValue(
        mockEvent
      );
      (qualificationRepo.getOrCreateQualificationRound as jest.Mock).mockResolvedValue(
        mockRound
      );
      (eventPlayerRepo.getEventPlayersBulk as jest.Mock).mockResolvedValue(
        mockEventPlayers
      );
      (qualificationRepo.getQualificationFramesBulk as jest.Mock).mockResolvedValue({});

      const result = await getBatchPlayerQualificationData(accessCode, [
        'ep-1',
        'ep-2',
        'ep-3',
      ]);

      expect(result.players).toHaveLength(1);
      expect(result.players[0].event_player_id).toBe('ep-1');
    });

    it('should return empty players when none are valid', async () => {
      const mockEvent = createMockEvent({ id: 'event-123' });
      const mockRound = createMockQualificationRound({ frame_count: 10 });

      (eventRepo.getEventByAccessCodeForQualification as jest.Mock).mockResolvedValue(
        mockEvent
      );
      (qualificationRepo.getOrCreateQualificationRound as jest.Mock).mockResolvedValue(
        mockRound
      );
      (eventPlayerRepo.getEventPlayersBulk as jest.Mock).mockResolvedValue([]);

      const result = await getBatchPlayerQualificationData(accessCode, eventPlayerIds);

      expect(result.players).toEqual([]);
    });
  });
});
