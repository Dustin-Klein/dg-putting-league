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

import { deleteLeague, isLeagueOwner } from '../league-repository';

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
});
