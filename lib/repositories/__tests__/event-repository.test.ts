/**
 * Event Repository Tests
 *
 * Tests for event data access functions including:
 * - Event CRUD operations
 * - Event with players/teams queries
 * - Access code validation
 * - Participant counts
 * - Status management
 */

import {
  createMockSupabaseClient,
  createMockQueryBuilder,
  MockSupabaseClient,
} from '@/lib/services/__tests__/test-utils';
import { InternalError, NotFoundError } from '@/lib/errors';

// Mock server-only before importing repository
jest.mock('server-only', () => ({}));

import {
  getEventWithPlayers,
  getEventById,
  getEventLeagueId,
  getEventsByLeagueId,
  updateEvent,
  updateEventStatus,
  deleteEvent,
  getQualificationRound,
  getQualificationFrameCounts,
  getEventByAccessCodeForQualification,
  getEventByAccessCodeForBracket,
  getEventScoringConfig,
  getEventStatusByAccessCode,
  isAccessCodeUnique,
  createEvent,
  getEventBracketFrameCount,
} from '../event-repository';

describe('Event Repository', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
  });

  describe('getEventWithPlayers', () => {
    it('should return event with players and teams', async () => {
      const mockEvent = {
        id: 'event-123',
        league_id: 'league-123',
        event_date: '2024-06-15',
        status: 'created',
        players: [
          {
            id: 'ep-1',
            player: { id: 'p-1', full_name: 'Player One' },
          },
        ],
        teams: [],
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockEvent, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventWithPlayers(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockEvent);
      expect(mockSupabase.from).toHaveBeenCalledWith('events');
    });

    it('should throw NotFoundError when event not found', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(getEventWithPlayers(mockSupabase as any, 'event-123')).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw InternalError on query failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(getEventWithPlayers(mockSupabase as any, 'event-123')).rejects.toThrow(
        InternalError
      );
    });
  });

  describe('getEventById', () => {
    it('should return event when found', async () => {
      const mockEvent = {
        id: 'event-123',
        league_id: 'league-123',
        event_date: '2024-06-15',
        status: 'created',
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockEvent, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventById(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockEvent);
    });

    it('should return null when event not found', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventById(mockSupabase as any, 'event-123');

      expect(result).toBeNull();
    });

    it('should throw InternalError on query failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(getEventById(mockSupabase as any, 'event-123')).rejects.toThrow(InternalError);
    });
  });

  describe('getEventLeagueId', () => {
    it('should return league_id when event found', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: { league_id: 'league-123' }, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventLeagueId(mockSupabase as any, 'event-123');

      expect(result).toBe('league-123');
    });

    it('should return null on error', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: null, error: { message: 'Not found' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventLeagueId(mockSupabase as any, 'event-123');

      expect(result).toBeNull();
    });
  });

  describe('getEventsByLeagueId', () => {
    it('should return events with participant counts', async () => {
      const mockEvents = [
        { id: 'event-1', league_id: 'league-123', event_date: '2024-06-15' },
        { id: 'event-2', league_id: 'league-123', event_date: '2024-06-20' },
      ];
      const mockEventPlayers = [
        { event_id: 'event-1' },
        { event_id: 'event-1' },
        { event_id: 'event-2' },
      ];

      const eventsQuery = createMockQueryBuilder();
      eventsQuery.select.mockReturnThis();
      eventsQuery.eq.mockReturnThis();
      eventsQuery.order.mockResolvedValue({ data: mockEvents, error: null });

      const eventPlayersQuery = createMockQueryBuilder();
      eventPlayersQuery.select.mockReturnThis();
      eventPlayersQuery.in.mockResolvedValue({ data: mockEventPlayers, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'events') return eventsQuery;
        if (table === 'event_players') return eventPlayersQuery;
        return createMockQueryBuilder();
      });

      const result = await getEventsByLeagueId(mockSupabase as any, 'league-123');

      expect(result).toHaveLength(2);
      expect(result[0].participant_count).toBe(2);
      expect(result[1].participant_count).toBe(1);
    });

    it('should return empty array when no events', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: [], error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventsByLeagueId(mockSupabase as any, 'league-123');

      expect(result).toEqual([]);
    });

    it('should throw InternalError on events query failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(getEventsByLeagueId(mockSupabase as any, 'league-123')).rejects.toThrow(
        InternalError
      );
    });
  });

  describe('updateEvent', () => {
    it('should update event and return updated data', async () => {
      const updatedEvent = {
        id: 'event-123',
        league_id: 'league-123',
        location: 'New Location',
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.select.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: updatedEvent, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await updateEvent(mockSupabase as any, 'event-123', {
        location: 'New Location',
      });

      expect(result).toEqual(updatedEvent);
      expect(mockQuery.update).toHaveBeenCalledWith({ location: 'New Location' });
    });

    it('should throw InternalError on update failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.select.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: null, error: { message: 'Update failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        updateEvent(mockSupabase as any, 'event-123', { location: 'New' })
      ).rejects.toThrow(InternalError);
    });
  });

  describe('updateEventStatus', () => {
    it('should update event status', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await updateEventStatus(mockSupabase as any, 'event-123', 'bracket');

      expect(mockQuery.update).toHaveBeenCalledWith({ status: 'bracket' });
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: { message: 'Update failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        updateEventStatus(mockSupabase as any, 'event-123', 'bracket')
      ).rejects.toThrow(InternalError);
    });
  });

  describe('deleteEvent', () => {
    it('should delete event', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.delete.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await deleteEvent(mockSupabase as any, 'event-123');

      expect(mockSupabase.from).toHaveBeenCalledWith('events');
      expect(mockQuery.delete).toHaveBeenCalled();
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.delete.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: { message: 'Delete failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(deleteEvent(mockSupabase as any, 'event-123')).rejects.toThrow(InternalError);
    });
  });

  describe('getQualificationRound', () => {
    it('should return qualification round when found', async () => {
      const mockRound = { frame_count: 10 };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: mockRound, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getQualificationRound(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockRound);
    });

    it('should return null when not found', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getQualificationRound(mockSupabase as any, 'event-123');

      expect(result).toBeNull();
    });
  });

  describe('getQualificationFrameCounts', () => {
    it('should return frame counts per player', async () => {
      const mockFrames = [
        { event_player_id: 'ep-1' },
        { event_player_id: 'ep-1' },
        { event_player_id: 'ep-2' },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ data: mockFrames, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getQualificationFrameCounts(mockSupabase as any, 'event-123');

      expect(result).toEqual({
        'ep-1': 2,
        'ep-2': 1,
      });
    });

    it('should return empty object when no frames', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ data: [], error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getQualificationFrameCounts(mockSupabase as any, 'event-123');

      expect(result).toEqual({});
    });
  });

  describe('getEventByAccessCodeForQualification', () => {
    it('should return event matching access code for qualification', async () => {
      const mockEvent = {
        id: 'event-123',
        event_date: '2024-06-15',
        location: 'Test',
        lane_count: 4,
        bonus_point_enabled: true,
        qualification_round_enabled: true,
        qualification_frame_count: 10,
        status: 'pre-bracket',
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.ilike.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockEvent, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventByAccessCodeForQualification(mockSupabase as any, 'ABC123');

      expect(result).toEqual(mockEvent);
      expect(mockQuery.ilike).toHaveBeenCalledWith('access_code', 'ABC123');
      expect(mockQuery.eq).toHaveBeenCalledWith('status', 'pre-bracket');
      expect(mockQuery.eq).toHaveBeenCalledWith('qualification_round_enabled', true);
    });

    it('should return null when no matching event', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.ilike.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventByAccessCodeForQualification(mockSupabase as any, 'INVALID');

      expect(result).toBeNull();
    });
  });

  describe('getEventByAccessCodeForBracket', () => {
    it('should return event matching access code for bracket', async () => {
      const mockEvent = {
        id: 'event-123',
        event_date: '2024-06-15',
        location: 'Test',
        lane_count: 4,
        bonus_point_enabled: true,
        bracket_frame_count: 5,
        status: 'bracket',
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.ilike.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockEvent, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventByAccessCodeForBracket(mockSupabase as any, 'ABC123');

      expect(result).toEqual(mockEvent);
      expect(mockQuery.eq).toHaveBeenCalledWith('status', 'bracket');
    });
  });

  describe('getEventScoringConfig', () => {
    it('should return scoring config', async () => {
      const mockConfig = { status: 'bracket', bonus_point_enabled: true };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockConfig, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventScoringConfig(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockConfig);
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(getEventScoringConfig(mockSupabase as any, 'event-123')).rejects.toThrow(
        InternalError
      );
    });
  });

  describe('getEventStatusByAccessCode', () => {
    it('should return event status info', async () => {
      const mockStatus = {
        id: 'event-123',
        status: 'bracket',
        qualification_round_enabled: false,
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.ilike.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockStatus, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventStatusByAccessCode(mockSupabase as any, 'ABC123');

      expect(result).toEqual(mockStatus);
    });
  });

  describe('isAccessCodeUnique', () => {
    it('should return true when access code is unique', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.ilike.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await isAccessCodeUnique(mockSupabase as any, 'NEWCODE');

      expect(result).toBe(true);
    });

    it('should return false when access code exists', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.ilike.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: { id: 'event-123' }, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await isAccessCodeUnique(mockSupabase as any, 'EXISTING');

      expect(result).toBe(false);
    });

    it('should throw InternalError on query failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.ilike.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(isAccessCodeUnique(mockSupabase as any, 'ANYCODE')).rejects.toThrow(
        InternalError
      );
    });
  });

  describe('createEvent', () => {
    it('should create event and return it', async () => {
      const newEvent = {
        id: 'event-new',
        league_id: 'league-123',
        event_date: '2024-06-15',
        location: 'Test',
        lane_count: 4,
        putt_distance_ft: 15,
        access_code: 'ABC123',
        qualification_round_enabled: false,
        bracket_frame_count: 5,
        qualification_frame_count: 10,
        status: 'created' as const,
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.insert.mockReturnThis();
      mockQuery.select.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: newEvent, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await createEvent(mockSupabase as any, newEvent);

      expect(result).toEqual(newEvent);
      expect(mockSupabase.from).toHaveBeenCalledWith('events');
    });

    it('should throw InternalError on creation failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.insert.mockReturnThis();
      mockQuery.select.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: null, error: { message: 'Insert failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        createEvent(mockSupabase as any, {
          league_id: 'league-123',
          event_date: '2024-06-15',
          location: null,
          lane_count: 4,
          putt_distance_ft: 15,
          access_code: 'ABC123',
          qualification_round_enabled: false,
          bracket_frame_count: 5,
          qualification_frame_count: 10,
          status: 'created',
        })
      ).rejects.toThrow(InternalError);
    });
  });

  describe('getEventBracketFrameCount', () => {
    it('should return bracket frame count', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: { bracket_frame_count: 5 }, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventBracketFrameCount(mockSupabase as any, 'event-123');

      expect(result).toBe(5);
    });

    it('should return null when no bracket frame count', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: { bracket_frame_count: null }, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getEventBracketFrameCount(mockSupabase as any, 'event-123');

      expect(result).toBeNull();
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(getEventBracketFrameCount(mockSupabase as any, 'event-123')).rejects.toThrow(
        InternalError
      );
    });
  });
});
