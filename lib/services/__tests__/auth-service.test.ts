/**
 * Auth Service Tests
 *
 * Tests for authentication and authorization functions:
 * - requireAuthenticatedUser()
 * - requireLeagueAdmin()
 */

import { UnauthorizedError, ForbiddenError, InternalError } from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockUser,
  createMockLeagueAdmin,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/repositories/league-repository', () => ({
  getLeagueAdminByUserAndLeague: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { getLeagueAdminByUserAndLeague } from '@/lib/repositories/league-repository';
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

      (getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue(mockAdmin);

      const result = await requireLeagueAdmin(leagueId);

      expect(result.user.id).toBe('user-123');
      expect(result.isAdmin).toBe(true);
      expect(getLeagueAdminByUserAndLeague).toHaveBeenCalledWith(mockSupabase, leagueId, 'user-123');
    });

    it('should throw ForbiddenError when user is not a league admin', async () => {
      (getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue(null);

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

      (getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue(mockAdmin);

      const result = await requireLeagueAdmin(differentLeagueId);

      expect(result.isAdmin).toBe(true);
      expect(getLeagueAdminByUserAndLeague).toHaveBeenCalledWith(mockSupabase, differentLeagueId, 'user-123');
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

      (getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue(mockAdmin);

      const result = await requireLeagueAdmin(leagueId);

      expect(result.user.id).toBe(userId);
      expect(getLeagueAdminByUserAndLeague).toHaveBeenCalledWith(mockSupabase, leagueId, userId);
    });

    it('should propagate InternalError when repository throws database error', async () => {
      (getLeagueAdminByUserAndLeague as jest.Mock).mockRejectedValue(
        new InternalError('Failed to fetch league admin: DB error')
      );

      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow(InternalError);
      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow('Failed to fetch league admin');
    });
  });
});
