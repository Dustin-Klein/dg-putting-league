/**
 * Auth Service Tests
 *
 * Tests for authentication and authorization functions:
 * - requireAuthenticatedUser()
 * - requireLeagueAdmin()
 */

import { UnauthorizedError, ForbiddenError } from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockQueryBuilder,
  createMockUser,
  createMockLeagueAdmin,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { requireAuthenticatedUser, requireLeagueAdmin } from '../auth/auth-service';

describe('Auth Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('requireAuthenticatedUser', () => {
    it('should return the user when authenticated', async () => {
      const mockUser = createMockUser({ id: 'user-456', email: 'test@example.com' });
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const result = await requireAuthenticatedUser();

      expect(result).toEqual(mockUser);
      expect(mockSupabase.auth.getUser).toHaveBeenCalled();
    });

    it('should throw UnauthorizedError when no user is found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      await expect(requireAuthenticatedUser()).rejects.toThrow(UnauthorizedError);
      await expect(requireAuthenticatedUser()).rejects.toThrow('Authentication required');
    });

    it('should throw UnauthorizedError when auth returns an error', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Auth error'),
      });

      await expect(requireAuthenticatedUser()).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError when both user and error exist', async () => {
      const mockUser = createMockUser();
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: new Error('Auth warning'),
      });

      await expect(requireAuthenticatedUser()).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('requireLeagueAdmin', () => {
    const leagueId = 'league-123';

    beforeEach(() => {
      // Set up successful auth by default
      const mockUser = createMockUser({ id: 'user-123' });
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });
    });

    it('should return user and isAdmin flag when user is a league admin', async () => {
      const mockAdmin = createMockLeagueAdmin({
        league_id: leagueId,
        user_id: 'user-123',
      });

      const queryBuilder = createMockQueryBuilder({
        data: mockAdmin,
        error: null,
      });
      mockSupabase.from.mockReturnValue(queryBuilder);

      const result = await requireLeagueAdmin(leagueId);

      expect(result.user.id).toBe('user-123');
      expect(result.isAdmin).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('league_admins');
      expect(queryBuilder.eq).toHaveBeenCalledWith('league_id', leagueId);
      expect(queryBuilder.eq).toHaveBeenCalledWith('user_id', 'user-123');
    });

    it('should throw ForbiddenError when user is not a league admin', async () => {
      const queryBuilder = createMockQueryBuilder({
        data: null,
        error: null,
      });
      mockSupabase.from.mockReturnValue(queryBuilder);

      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow(ForbiddenError);
      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow('Insufficient permissions');
    });

    it('should throw UnauthorizedError when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow(UnauthorizedError);
    });

    it('should work with different league IDs', async () => {
      const differentLeagueId = 'league-456';
      const mockAdmin = createMockLeagueAdmin({
        league_id: differentLeagueId,
        user_id: 'user-123',
      });

      const queryBuilder = createMockQueryBuilder({
        data: mockAdmin,
        error: null,
      });
      mockSupabase.from.mockReturnValue(queryBuilder);

      const result = await requireLeagueAdmin(differentLeagueId);

      expect(result.isAdmin).toBe(true);
      expect(queryBuilder.eq).toHaveBeenCalledWith('league_id', differentLeagueId);
    });

    it('should check admin status for the authenticated user', async () => {
      const userId = 'specific-user-789';
      const mockUser = createMockUser({ id: userId });
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const mockAdmin = createMockLeagueAdmin({
        league_id: leagueId,
        user_id: userId,
      });

      const queryBuilder = createMockQueryBuilder({
        data: mockAdmin,
        error: null,
      });
      mockSupabase.from.mockReturnValue(queryBuilder);

      const result = await requireLeagueAdmin(leagueId);

      expect(result.user.id).toBe(userId);
      expect(queryBuilder.eq).toHaveBeenCalledWith('user_id', userId);
    });
  });
});
