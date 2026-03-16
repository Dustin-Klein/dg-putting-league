/**
 * League Repository Tests
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  createMockSupabaseClient,
  createMockQueryBuilder,
  MockSupabaseClient,
} from '@/lib/services/__tests__/test-utils';
import { InternalError } from '@/lib/errors';

jest.mock('server-only', () => ({}));

import { deleteLeague } from '../league-repository';

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
      mockQuery.eq.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await deleteLeague(mockSupabase as any, 'league-123');

      expect(mockSupabase.from).toHaveBeenCalledWith('leagues');
      expect(mockQuery.delete).toHaveBeenCalled();
      expect(mockQuery.eq).toHaveBeenCalledWith('id', 'league-123');
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.delete.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: { message: 'Delete failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(deleteLeague(mockSupabase as any, 'league-123')).rejects.toThrow(InternalError);
    });
  });
});
