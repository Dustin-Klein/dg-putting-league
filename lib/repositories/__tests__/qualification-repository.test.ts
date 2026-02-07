/**
 * Qualification Repository Tests
 *
 * Tests for qualification round data access including:
 * - Qualification round CRUD
 * - Frame recording with upsert
 * - Frame aggregations
 * - Bulk frame queries
 * - Player status queries
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  createMockSupabaseClient,
  createMockQueryBuilder,
  MockSupabaseClient,
} from '@/lib/services/__tests__/test-utils';
import { InternalError } from '@/lib/errors';

// Mock server-only before importing repository
jest.mock('server-only', () => ({}));

import {
  getOrCreateQualificationRound,
  getQualificationRoundFull,
  updateQualificationRoundStatus,
  getPlayerQualificationFrames,
  getQualificationFramesBulk,
  getQualificationFrameAggregations,
  getEventQualificationFrames,
  recordQualificationFrame,
  getEventPlayersQualificationStatus,
  getPaidEventPlayers,
  getQualificationFrame,
  deleteQualificationFrame,
  getNextFrameNumber,
} from '../qualification-repository';

describe('Qualification Repository', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
  });

  describe('getOrCreateQualificationRound', () => {
    it('should return existing round when found', async () => {
      const existingRound = {
        id: 'round-123',
        event_id: 'event-123',
        frame_count: 10,
        status: 'in_progress',
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: existingRound, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getOrCreateQualificationRound(mockSupabase as any, 'event-123', 10);

      expect(result).toEqual(existingRound);
    });

    it('should create new round when not found', async () => {
      const newRound = {
        id: 'round-new',
        event_id: 'event-123',
        frame_count: 10,
        status: 'not_started',
      };

      // First query returns null (not found)
      const selectQuery = createMockQueryBuilder();
      selectQuery.select.mockReturnThis();
      selectQuery.eq.mockReturnThis();
      selectQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

      // Insert query returns new round
      const insertQuery = createMockQueryBuilder();
      insertQuery.insert.mockReturnThis();
      insertQuery.select.mockReturnThis();
      insertQuery.single.mockResolvedValue({ data: newRound, error: null });

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return selectQuery;
        return insertQuery;
      });

      const result = await getOrCreateQualificationRound(mockSupabase as any, 'event-123', 10);

      expect(result).toEqual(newRound);
    });

    it('should throw InternalError when fetch fails', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Fetch failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        getOrCreateQualificationRound(mockSupabase as any, 'event-123', 10)
      ).rejects.toThrow(InternalError);
    });

    it('should throw InternalError when insert fails', async () => {
      const selectQuery = createMockQueryBuilder();
      selectQuery.select.mockReturnThis();
      selectQuery.eq.mockReturnThis();
      selectQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

      const insertQuery = createMockQueryBuilder();
      insertQuery.insert.mockReturnThis();
      insertQuery.select.mockReturnThis();
      insertQuery.single.mockResolvedValue({ data: null, error: { message: 'Insert failed' } });

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return selectQuery;
        return insertQuery;
      });

      await expect(
        getOrCreateQualificationRound(mockSupabase as any, 'event-123', 10)
      ).rejects.toThrow(InternalError);
    });
  });

  describe('getQualificationRoundFull', () => {
    it('should return full round data when found', async () => {
      const mockRound = {
        id: 'round-123',
        event_id: 'event-123',
        frame_count: 10,
        status: 'in_progress',
        created_by: 'user-1',
        created_at: '2024-01-01T00:00:00Z',
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockRound, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getQualificationRoundFull(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockRound);
    });

    it('should return null when not found', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getQualificationRoundFull(mockSupabase as any, 'event-123');

      expect(result).toBeNull();
    });
  });

  describe('updateQualificationRoundStatus', () => {
    it('should update round status', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await updateQualificationRoundStatus(mockSupabase as any, 'round-123', 'completed');

      expect(mockQuery.update).toHaveBeenCalledWith({ status: 'completed' });
      expect(mockQuery.eq).toHaveBeenCalledWith('id', 'round-123');
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: { message: 'Update failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        updateQualificationRoundStatus(mockSupabase as any, 'round-123', 'completed')
      ).rejects.toThrow(InternalError);
    });
  });

  describe('getPlayerQualificationFrames', () => {
    it('should return ordered frames for player', async () => {
      const mockFrames = [
        { id: 'f1', event_player_id: 'ep-1', frame_number: 1, putts_made: 2, points_earned: 2 },
        { id: 'f2', event_player_id: 'ep-1', frame_number: 2, putts_made: 3, points_earned: 3 },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: mockFrames, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPlayerQualificationFrames(mockSupabase as any, 'event-123', 'ep-1');

      expect(result).toEqual(mockFrames);
      expect(mockQuery.order).toHaveBeenCalledWith('frame_number');
    });

    it('should return empty array when no frames', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPlayerQualificationFrames(mockSupabase as any, 'event-123', 'ep-1');

      expect(result).toEqual([]);
    });
  });

  describe('getQualificationFramesBulk', () => {
    it('should return empty object for empty input', async () => {
      const result = await getQualificationFramesBulk(mockSupabase as any, 'event-123', []);

      expect(result).toEqual({});
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should return frames grouped by player', async () => {
      const mockFrames = [
        { id: 'f1', event_player_id: 'ep-1', frame_number: 1 },
        { id: 'f2', event_player_id: 'ep-1', frame_number: 2 },
        { id: 'f3', event_player_id: 'ep-2', frame_number: 1 },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.in.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: mockFrames, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getQualificationFramesBulk(mockSupabase as any, 'event-123', [
        'ep-1',
        'ep-2',
      ]);

      expect(result['ep-1']).toHaveLength(2);
      expect(result['ep-2']).toHaveLength(1);
    });
  });

  describe('getQualificationFrameAggregations', () => {
    it('should return aggregated counts and points per player', async () => {
      const mockFrames = [
        { event_player_id: 'ep-1', points_earned: 2 },
        { event_player_id: 'ep-1', points_earned: 3 },
        { event_player_id: 'ep-2', points_earned: 4 },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ data: mockFrames, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getQualificationFrameAggregations(mockSupabase as any, 'event-123');

      expect(result).toEqual({
        'ep-1': { count: 2, totalPoints: 5 },
        'ep-2': { count: 1, totalPoints: 4 },
      });
    });

    it('should return empty object when no frames', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ data: [], error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getQualificationFrameAggregations(mockSupabase as any, 'event-123');

      expect(result).toEqual({});
    });
  });

  describe('getEventQualificationFrames', () => {
    it('should return frames with player info', async () => {
      const mockFrames = [
        {
          id: 'f1',
          event_player: {
            id: 'ep-1',
            player: { id: 'p1', full_name: 'Player One', nickname: 'P1' },
          },
        },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: mockFrames, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventQualificationFrames(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockFrames);
      expect(mockQuery.order).toHaveBeenCalledWith('recorded_at', { ascending: false });
    });
  });

  describe('recordQualificationFrame', () => {
    it('should upsert frame and return it', async () => {
      const mockFrame = {
        id: 'frame-1',
        qualification_round_id: 'round-1',
        event_id: 'event-123',
        event_player_id: 'ep-1',
        frame_number: 1,
        putts_made: 3,
        points_earned: 3,
      };
      const mockQuery = createMockQueryBuilder() as any;
      mockQuery.upsert = jest.fn().mockReturnThis();
      mockQuery.select.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: mockFrame, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await recordQualificationFrame(mockSupabase as any, {
        qualificationRoundId: 'round-1',
        eventId: 'event-123',
        eventPlayerId: 'ep-1',
        frameNumber: 1,
        puttsMade: 3,
        pointsEarned: 3,
      });

      expect(result).toEqual(mockFrame);
      expect(mockQuery.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          qualification_round_id: 'round-1',
          event_id: 'event-123',
          event_player_id: 'ep-1',
          frame_number: 1,
          putts_made: 3,
          points_earned: 3,
        }),
        { onConflict: 'event_player_id,frame_number' }
      );
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder() as any;
      mockQuery.upsert = jest.fn().mockReturnThis();
      mockQuery.select.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: null, error: { message: 'Upsert failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        recordQualificationFrame(mockSupabase as any, {
          qualificationRoundId: 'round-1',
          eventId: 'event-123',
          eventPlayerId: 'ep-1',
          frameNumber: 1,
          puttsMade: 3,
          pointsEarned: 3,
        })
      ).rejects.toThrow(InternalError);
    });
  });

  describe('getEventPlayersQualificationStatus', () => {
    it('should return qualification status for only paid players', async () => {
      const mockRound = { frame_count: 5 };
      const mockPlayers = [
        {
          id: 'ep-1',
          player_id: 'p1',
          payment_type: 'cash',
          player: { full_name: 'Player One' },
        },
        {
          id: 'ep-2',
          player_id: 'p2',
          payment_type: 'electronic',
          player: { full_name: 'Player Two' },
        },
      ];
      const mockFrames = [
        { event_player_id: 'ep-1', points_earned: 2 },
        { event_player_id: 'ep-1', points_earned: 3 },
        { event_player_id: 'ep-1', points_earned: 4 },
        { event_player_id: 'ep-1', points_earned: 2 },
        { event_player_id: 'ep-1', points_earned: 5 }, // 5 frames for ep-1, total 16
        { event_player_id: 'ep-2', points_earned: 3 },
        { event_player_id: 'ep-2', points_earned: 2 }, // 2 frames for ep-2, total 5
      ];

      // Round query
      const roundQuery = createMockQueryBuilder();
      roundQuery.select.mockReturnThis();
      roundQuery.eq.mockReturnThis();
      roundQuery.maybeSingle.mockResolvedValue({ data: mockRound, error: null });

      // Players query (needs .eq().not() chain)
      const playersQuery = createMockQueryBuilder();
      playersQuery.select.mockReturnThis();
      playersQuery.eq.mockReturnThis();
      playersQuery.not.mockResolvedValue({ data: mockPlayers, error: null });

      // Frames query
      const framesQuery = createMockQueryBuilder();
      framesQuery.select.mockReturnThis();
      framesQuery.eq.mockResolvedValue({ data: mockFrames, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'qualification_rounds') return roundQuery;
        if (table === 'event_players') return playersQuery;
        if (table === 'qualification_frames') return framesQuery;
        return createMockQueryBuilder();
      });

      const result = await getEventPlayersQualificationStatus(mockSupabase as any, 'event-123');

      expect(result).toHaveLength(2);
      expect(playersQuery.eq).toHaveBeenCalledWith('event_id', 'event-123');
      expect(playersQuery.not).toHaveBeenCalledWith('payment_type', 'is', null);
      expect(result[0]).toEqual({
        event_player_id: 'ep-1',
        player_id: 'p1',
        player_name: 'Player One',
        frames_completed: 5,
        total_frames_required: 5,
        total_points: 16,
        is_complete: true,
      });
      expect(result[1]).toEqual({
        event_player_id: 'ep-2',
        player_id: 'p2',
        player_name: 'Player Two',
        frames_completed: 2,
        total_frames_required: 5,
        total_points: 5,
        is_complete: false,
      });
    });

    it('should throw InternalError when round not found', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        getEventPlayersQualificationStatus(mockSupabase as any, 'event-123')
      ).rejects.toThrow(InternalError);
    });
  });

  describe('getPaidEventPlayers', () => {
    it('should return paid players with info', async () => {
      const mockPlayers = [
        {
          id: 'ep-1',
          player_id: 'p1',
          player: { id: 'p1', full_name: 'Player One', nickname: 'P1', player_number: 42 },
        },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.not.mockResolvedValue({ data: mockPlayers, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPaidEventPlayers(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockPlayers);
      expect(mockQuery.not).toHaveBeenCalledWith('payment_type', 'is', null);
    });

    it('should return empty array when no paid players', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.not.mockResolvedValue({ data: [], error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPaidEventPlayers(mockSupabase as any, 'event-123');

      expect(result).toEqual([]);
    });
  });

  describe('getQualificationFrame', () => {
    it('should return specific frame when found', async () => {
      const mockFrame = { id: 'f1', event_player_id: 'ep-1', frame_number: 1 };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockFrame, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getQualificationFrame(mockSupabase as any, 'ep-1', 1);

      expect(result).toEqual(mockFrame);
      expect(mockQuery.eq).toHaveBeenCalledWith('event_player_id', 'ep-1');
      expect(mockQuery.eq).toHaveBeenCalledWith('frame_number', 1);
    });

    it('should return null when not found', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getQualificationFrame(mockSupabase as any, 'ep-1', 99);

      expect(result).toBeNull();
    });
  });

  describe('deleteQualificationFrame', () => {
    it('should delete frame', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.delete.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await deleteQualificationFrame(mockSupabase as any, 'frame-123');

      expect(mockSupabase.from).toHaveBeenCalledWith('qualification_frames');
      expect(mockQuery.delete).toHaveBeenCalled();
      expect(mockQuery.eq).toHaveBeenCalledWith('id', 'frame-123');
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.delete.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: { message: 'Delete failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(deleteQualificationFrame(mockSupabase as any, 'frame-123')).rejects.toThrow(
        InternalError
      );
    });
  });

  describe('getNextFrameNumber', () => {
    it('should return next frame number', async () => {
      const mockData = [{ frame_number: 5 }];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockReturnThis();
      mockQuery.limit.mockResolvedValue({ data: mockData, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getNextFrameNumber(mockSupabase as any, 'ep-1');

      expect(result).toBe(6);
    });

    it('should return 1 when no existing frames', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockReturnThis();
      mockQuery.limit.mockResolvedValue({ data: [], error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getNextFrameNumber(mockSupabase as any, 'ep-1');

      expect(result).toBe(1);
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockReturnThis();
      mockQuery.limit.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(getNextFrameNumber(mockSupabase as any, 'ep-1')).rejects.toThrow(InternalError);
    });
  });
});
