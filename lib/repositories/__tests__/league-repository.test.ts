/**
 * League Repository Tests
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  createMockSupabaseClient,
  createMockQueryBuilder,
  MockSupabaseClient,
} from '@/lib/services/__tests__/test-utils';
import { InternalError, NotFoundError } from '@/lib/errors';

jest.mock('server-only', () => ({}));

import { deleteLeague, isLeagueOwner, getAllLeagues, getLeagueWithEvents } from '../league-repository';

describe('League Repository', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
  });

  describe('deleteLeague', () => {
    it('should delete the league by id', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.delete.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.select.mockResolvedValue({ data: [{ id: 'league-123' }], error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await deleteLeague(mockSupabase as any, 'league-123');

      expect(mockSupabase.from).toHaveBeenCalledWith('leagues');
      expect(mockQuery.delete).toHaveBeenCalled();
      expect(mockQuery.eq).toHaveBeenCalledWith('id', 'league-123');
    });

    it('should throw NotFoundError when no rows are deleted', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.delete.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.select.mockResolvedValue({ data: [], error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(deleteLeague(mockSupabase as any, 'league-123')).rejects.toThrow(NotFoundError);
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.delete.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.select.mockResolvedValue({ data: null, error: { message: 'Delete failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(deleteLeague(mockSupabase as any, 'league-123')).rejects.toThrow(InternalError);
    });
  });

  describe('isLeagueOwner', () => {
    it('should return true when an owner row exists', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.maybeSingle.mockResolvedValue({ data: { id: 'admin-1' }, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(isLeagueOwner(mockSupabase as any, 'league-123', 'user-123')).resolves.toBe(true);
      expect(mockQuery.eq).toHaveBeenCalledWith('role', 'owner');
    });

    it('should return false when no owner row exists', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(isLeagueOwner(mockSupabase as any, 'league-123', 'user-123')).resolves.toBe(false);
    });

    it('should throw InternalError when the query fails', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(isLeagueOwner(mockSupabase as any, 'league-123', 'user-123')).rejects.toThrow(
        InternalError
      );
    });
  });

  describe('getAllLeagues', () => {
    it('should return public leagues with event counts on happy path', async () => {
      const mockQuery = createMockQueryBuilder();
      const mockData = [
        { id: 'league-1', name: 'Alpha League', events: [{ id: 'e1' }, { id: 'e2' }] },
        { id: 'league-2', name: 'Beta League', events: [] }, // empty -> filtered out
        { id: 'league-3', name: 'Gamma League', events: [{ id: 'e3' }] },
      ];
      mockQuery.order.mockResolvedValue({ data: mockData, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getAllLeagues(mockSupabase as any);

      expect(mockSupabase.from).toHaveBeenCalledWith('leagues');
      expect(mockQuery.select).toHaveBeenCalledWith('id, name, events(id)');
      expect(mockQuery.order).toHaveBeenCalledWith('name');
      expect(result).toEqual([
        { id: 'league-1', name: 'Alpha League', event_count: 2 },
        { id: 'league-3', name: 'Gamma League', event_count: 1 },
      ]);
    });

    it('should throw InternalError when leagues query fails', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.order.mockResolvedValue({ data: null, error: { message: 'DB connection error' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(getAllLeagues(mockSupabase as any)).rejects.toThrow(InternalError);
      await expect(getAllLeagues(mockSupabase as any)).rejects.toThrow('Failed to fetch leagues');
    });

    it('should return empty array if data is null without error', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.order.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getAllLeagues(mockSupabase as any);
      expect(result).toEqual([]);
    });
  });

  describe('getLeagueWithEvents', () => {
    it('should return league with events and participant counts on happy path', async () => {
      const mockLeagueQuery = createMockQueryBuilder();
      mockLeagueQuery.maybeSingle.mockResolvedValue({
        data: { id: 'league-1', name: 'Test League' },
        error: null,
      });

      const mockEventsQuery = createMockQueryBuilder();
      mockEventsQuery.order.mockResolvedValue({
        data: [
          { id: 'ev-1', event_date: '2026-01-01', location: 'Park A', status: 'completed' },
          { id: 'ev-2', event_date: '2026-01-08', location: 'Park B', status: 'upcoming' },
        ],
        error: null,
      });

      const mockPlayerCountQuery1 = createMockQueryBuilder();
      mockPlayerCountQuery1.eq.mockResolvedValue({ count: 12, data: null, error: null });

      const mockPlayerCountQuery2 = createMockQueryBuilder();
      mockPlayerCountQuery2.eq.mockResolvedValue({ count: 8, data: null, error: null });

      let eventPlayerCallCount = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'leagues') return mockLeagueQuery;
        if (table === 'events') return mockEventsQuery;
        if (table === 'event_players') {
          eventPlayerCallCount++;
          return eventPlayerCallCount === 1 ? mockPlayerCountQuery1 : mockPlayerCountQuery2;
        }
        return createMockQueryBuilder();
      });

      const result = await getLeagueWithEvents(mockSupabase as any, 'league-1');

      expect(result).toEqual({
        id: 'league-1',
        name: 'Test League',
        event_count: 2,
        events: [
          {
            id: 'ev-1',
            event_date: '2026-01-01',
            location: 'Park A',
            status: 'completed',
            participant_count: 12,
          },
          {
            id: 'ev-2',
            event_date: '2026-01-08',
            location: 'Park B',
            status: 'upcoming',
            participant_count: 8,
          },
        ],
      });
    });

    it('should return null when league is not found', async () => {
      const mockLeagueQuery = createMockQueryBuilder();
      mockLeagueQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockLeagueQuery);

      const result = await getLeagueWithEvents(mockSupabase as any, 'league-missing');
      expect(result).toBeNull();
    });

    it('should throw InternalError when league query fails', async () => {
      const mockLeagueQuery = createMockQueryBuilder();
      mockLeagueQuery.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'League query failure' },
      });
      mockSupabase.from.mockReturnValue(mockLeagueQuery);

      await expect(getLeagueWithEvents(mockSupabase as any, 'league-1')).rejects.toThrow(
        InternalError
      );
      await expect(getLeagueWithEvents(mockSupabase as any, 'league-1')).rejects.toThrow(
        'Failed to fetch league'
      );
    });

    it('should throw InternalError when events query fails', async () => {
      const mockLeagueQuery = createMockQueryBuilder();
      mockLeagueQuery.maybeSingle.mockResolvedValue({
        data: { id: 'league-1', name: 'Test League' },
        error: null,
      });

      const mockEventsQuery = createMockQueryBuilder();
      mockEventsQuery.order.mockResolvedValue({
        data: null,
        error: { message: 'Events query failure' },
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'leagues') return mockLeagueQuery;
        if (table === 'events') return mockEventsQuery;
        return createMockQueryBuilder();
      });

      await expect(getLeagueWithEvents(mockSupabase as any, 'league-1')).rejects.toThrow(
        InternalError
      );
      await expect(getLeagueWithEvents(mockSupabase as any, 'league-1')).rejects.toThrow(
        'Failed to fetch events for league'
      );
    });

    it('should throw InternalError when event participant count query fails', async () => {
      const mockLeagueQuery = createMockQueryBuilder();
      mockLeagueQuery.maybeSingle.mockResolvedValue({
        data: { id: 'league-1', name: 'Test League' },
        error: null,
      });

      const mockEventsQuery = createMockQueryBuilder();
      mockEventsQuery.order.mockResolvedValue({
        data: [{ id: 'ev-1', event_date: '2026-01-01', location: 'Park A', status: 'completed' }],
        error: null,
      });

      const mockPlayerCountQuery = createMockQueryBuilder();
      mockPlayerCountQuery.eq.mockResolvedValue({
        count: null,
        data: null,
        error: { message: 'Count failed' },
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'leagues') return mockLeagueQuery;
        if (table === 'events') return mockEventsQuery;
        if (table === 'event_players') return mockPlayerCountQuery;
        return createMockQueryBuilder();
      });

      await expect(getLeagueWithEvents(mockSupabase as any, 'league-1')).rejects.toThrow(
        InternalError
      );
      await expect(getLeagueWithEvents(mockSupabase as any, 'league-1')).rejects.toThrow(
        'Failed to fetch participant count for event'
      );
    });
  });
});
