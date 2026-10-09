/**
 * Auth Service Tests
 *
 * Tests for authentication and authorization functions:
 * - requireAuthenticatedUser()
 * - requireLeagueAdmin()
 * - authorize*() — the only way to obtain the privileged client
 */

import {
  UnauthorizedError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  InvalidAccessCodeError,
} from '@/lib/errors';
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

jest.mock('@/lib/supabase/privileged', () => ({
  _createPrivilegedClient: jest.fn(),
}));

jest.mock('@/lib/db/client', () => ({
  _getDb: jest.fn(),
}));

jest.mock('@/lib/repositories/league-repository', () => ({
  getLeagueAdminByUserAndLeague: jest.fn(),
  isLeagueOwner: jest.fn(),
  isAnyLeagueAdmin: jest.fn(),
}));

jest.mock('@/lib/repositories/event-repository', () => ({
  getEventLeagueId: jest.fn(),
}));

jest.mock('@/lib/repositories/event-repository.db', () => ({
  getEventByAccessCode: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { _createPrivilegedClient } from '@/lib/supabase/privileged';
import { _getDb } from '@/lib/db/client';
import {
  getLeagueAdminByUserAndLeague,
  isLeagueOwner,
  isAnyLeagueAdmin,
} from '@/lib/repositories/league-repository';
import { getEventLeagueId } from '@/lib/repositories/event-repository';
import { getEventByAccessCode } from '@/lib/repositories/event-repository.db';
import {
  requireAuthenticatedUser,
  requireLeagueAdmin,
  authorizeLeagueAdmin,
  authorizeLeagueOwner,
  authorizeEventAdmin,
  authorizeAnyLeagueAdmin,
  authorizeLeagueCreation,
  authorizeAccessCode,
} from '../auth/auth-service';

describe('Auth Service', () => {
  let mockSupabase: MockSupabaseClient;
  let mockDb: MockSupabaseClient;
  const mockPg = {};

  const signIn = (userId = 'user-123') => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: createMockUser({ id: userId }) },
      error: null,
    });
  };

  const signOut = () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    mockDb = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    (_createPrivilegedClient as jest.Mock).mockReturnValue(mockDb);
    (_getDb as jest.Mock).mockReturnValue(mockPg);
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
      signOut();

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

    beforeEach(() => signIn());

    it('should return user and isAdmin flag when user is a league admin', async () => {
      (getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue(
        createMockLeagueAdmin({ league_id: leagueId, user_id: 'user-123' })
      );

      const result = await requireLeagueAdmin(leagueId);

      expect(result.user.id).toBe('user-123');
      expect(result.isAdmin).toBe(true);
      expect(getLeagueAdminByUserAndLeague).toHaveBeenCalledWith(mockDb, leagueId, 'user-123');
    });

    it('should throw ForbiddenError when user is not a league admin', async () => {
      (getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue(null);

      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow(ForbiddenError);
      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow('Insufficient permissions');
    });

    it('should throw UnauthorizedError when user is not authenticated', async () => {
      signOut();

      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow(UnauthorizedError);
      expect(_createPrivilegedClient).not.toHaveBeenCalled();
    });

    it('should propagate InternalError when repository throws database error', async () => {
      (getLeagueAdminByUserAndLeague as jest.Mock).mockRejectedValue(
        new InternalError('Failed to fetch league admin: DB error')
      );

      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow(InternalError);
      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow('Failed to fetch league admin');
    });
  });

  describe('authorizeLeagueAdmin', () => {
    it('returns the privileged client for a league admin', async () => {
      signIn();
      (getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue({ id: 'admin-1' });

      const result = await authorizeLeagueAdmin('league-1');

      expect(result.db).toBe(mockDb);
      expect(result.pg).toBe(mockPg);
      expect(result.user.id).toBe('user-123');
    });

    it('rejects a non-admin', async () => {
      signIn();
      (getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue(null);

      await expect(authorizeLeagueAdmin('league-1')).rejects.toThrow(ForbiddenError);
    });
  });

  describe('authorizeLeagueOwner', () => {
    it('returns the privileged client for the owner', async () => {
      signIn('owner-1');
      (isLeagueOwner as jest.Mock).mockResolvedValue(true);

      const result = await authorizeLeagueOwner('league-1');

      expect(result.db).toBe(mockDb);
      expect(isLeagueOwner).toHaveBeenCalledWith(mockDb, 'league-1', 'owner-1');
    });

    it('rejects a non-owner admin with the given message', async () => {
      signIn();
      (isLeagueOwner as jest.Mock).mockResolvedValue(false);

      await expect(authorizeLeagueOwner('league-1', 'Owners only')).rejects.toThrow('Owners only');
    });

    it('rejects an anonymous caller before creating a privileged client', async () => {
      signOut();

      await expect(authorizeLeagueOwner('league-1')).rejects.toThrow(UnauthorizedError);
      expect(_createPrivilegedClient).not.toHaveBeenCalled();
    });
  });

  describe('authorizeEventAdmin', () => {
    it('checks admin rights on the event league', async () => {
      signIn();
      (getEventLeagueId as jest.Mock).mockResolvedValue('league-9');
      (getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue({ id: 'admin-1' });

      const result = await authorizeEventAdmin('event-1');

      expect(result.db).toBe(mockDb);
      expect(getLeagueAdminByUserAndLeague).toHaveBeenCalledWith(mockDb, 'league-9', 'user-123');
    });

    it('rejects an unknown event', async () => {
      signIn();
      (getEventLeagueId as jest.Mock).mockResolvedValue(null);

      await expect(authorizeEventAdmin('missing')).rejects.toThrow(ForbiddenError);
      expect(getLeagueAdminByUserAndLeague).not.toHaveBeenCalled();
    });

    it('rejects an admin of a different league', async () => {
      signIn();
      (getEventLeagueId as jest.Mock).mockResolvedValue('league-9');
      (getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue(null);

      await expect(authorizeEventAdmin('event-1')).rejects.toThrow(ForbiddenError);
    });
  });

  describe('authorizeAnyLeagueAdmin', () => {
    it('allows an admin of any league', async () => {
      signIn();
      (isAnyLeagueAdmin as jest.Mock).mockResolvedValue(true);

      await expect(authorizeAnyLeagueAdmin()).resolves.toMatchObject({ db: mockDb });
    });

    it('rejects a signed-in user who administers no league', async () => {
      signIn();
      (isAnyLeagueAdmin as jest.Mock).mockResolvedValue(false);

      await expect(authorizeAnyLeagueAdmin()).rejects.toThrow(ForbiddenError);
    });
  });

  describe('authorizeLeagueCreation', () => {
    it('requires a signed-in user', async () => {
      signOut();

      await expect(authorizeLeagueCreation()).rejects.toThrow(UnauthorizedError);
      expect(_createPrivilegedClient).not.toHaveBeenCalled();
    });
  });

  describe('authorizeAccessCode', () => {
    const bracketEvent = {
      id: 'event-1',
      event_date: '2026-01-01',
      location: null,
      lane_count: 4,
      bonus_point_enabled: true,
      bracket_frame_count: 5,
      qualification_round_enabled: false,
      qualification_frame_count: 5,
      status: 'bracket',
    };

    it('normalizes the code and looks it up exactly', async () => {
      (getEventByAccessCode as jest.Mock).mockResolvedValue(bracketEvent);

      const result = await authorizeAccessCode('  AbC123 ');

      expect(getEventByAccessCode).toHaveBeenCalledWith(mockPg, 'abc123');
      expect(result).toEqual({ event: bracketEvent, db: mockDb, pg: mockPg });
    });

    it('does not treat LIKE wildcards specially', async () => {
      (getEventByAccessCode as jest.Mock).mockResolvedValue(null);

      await expect(authorizeAccessCode('%')).rejects.toThrow(InvalidAccessCodeError);
      await expect(authorizeAccessCode('______')).rejects.toThrow(InvalidAccessCodeError);
      expect(getEventByAccessCode).toHaveBeenCalledWith(mockPg, '%');
      expect(getEventByAccessCode).toHaveBeenCalledWith(mockPg, '______');
    });

    it('rejects an empty code without a lookup', async () => {
      await expect(authorizeAccessCode('   ')).rejects.toThrow(InvalidAccessCodeError);
      expect(getEventByAccessCode).not.toHaveBeenCalled();
    });

    it('rejects a valid code when the event is in the wrong mode', async () => {
      (getEventByAccessCode as jest.Mock).mockResolvedValue(bracketEvent);

      const promise = authorizeAccessCode('abc123', { mode: 'qualification' });
      await expect(promise).rejects.toThrow(NotFoundError);
      await expect(authorizeAccessCode('abc123', { mode: 'qualification' })).rejects.not.toThrow(
        InvalidAccessCodeError
      );
    });

    it('accepts qualification mode only for pre-bracket events with qualification enabled', async () => {
      (getEventByAccessCode as jest.Mock).mockResolvedValue({
        ...bracketEvent,
        status: 'pre-bracket',
        qualification_round_enabled: true,
      });

      await expect(authorizeAccessCode('abc123', { mode: 'qualification' })).resolves.toMatchObject({
        event: { id: 'event-1' },
      });
      await expect(authorizeAccessCode('abc123', { mode: 'bracket' })).rejects.toThrow(NotFoundError);
    });
  });
});
