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

jest.mock('@/lib/repositories/league-repository.db', () => ({
  getLeagueAdminRole: jest.fn(),
  isAnyLeagueAdmin: jest.fn(),
}));

jest.mock('@/lib/repositories/event-repository.db', () => ({
  getEventAccess: jest.fn(),
  getEventByAccessCode: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { _createPrivilegedClient } from '@/lib/supabase/privileged';
import { _getDb } from '@/lib/db/client';
import { getLeagueAdminRole, isAnyLeagueAdmin } from '@/lib/repositories/league-repository.db';
import { getEventAccess, getEventByAccessCode } from '@/lib/repositories/event-repository.db';
import {
  requireAuthenticatedUser,
  requireLeagueAdmin,
  authorizeLeagueAdmin,
  authorizeLeagueOwner,
  authorizeEventAdmin,
  authorizeAnyLeagueAdmin,
  authorizeLeagueCreation,
  authorizeAccessCode,
  authorizeEventView,
  getViewer,
} from '../auth/auth-service';

const LEAGUE_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';

function eventAccess(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    league_id: LEAGUE_ID,
    status: 'bracket',
    qualification_round_enabled: false,
    admin_role: null,
    ...overrides,
  };
}

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
    const leagueId = LEAGUE_ID;

    beforeEach(() => signIn());

    it('should return user and isAdmin flag when user is a league admin', async () => {
      (getLeagueAdminRole as jest.Mock).mockResolvedValue('admin');

      const result = await requireLeagueAdmin(leagueId);

      expect(result.user.id).toBe('user-123');
      expect(result.isAdmin).toBe(true);
      expect(getLeagueAdminRole).toHaveBeenCalledWith(mockPg, leagueId, 'user-123');
    });

    it('should throw ForbiddenError when user is not a league admin', async () => {
      (getLeagueAdminRole as jest.Mock).mockResolvedValue(null);

      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow(ForbiddenError);
      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow('Insufficient permissions');
    });

    it('should throw UnauthorizedError when user is not authenticated', async () => {
      signOut();

      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow(UnauthorizedError);
      expect(_createPrivilegedClient).not.toHaveBeenCalled();
      expect(getLeagueAdminRole).not.toHaveBeenCalled();
    });

    it('rejects a malformed league id without a query', async () => {
      await expect(requireLeagueAdmin('not-a-uuid')).rejects.toThrow(ForbiddenError);
      expect(getLeagueAdminRole).not.toHaveBeenCalled();
    });

    it('should propagate InternalError when repository throws database error', async () => {
      (getLeagueAdminRole as jest.Mock).mockRejectedValue(new InternalError('DB error'));

      await expect(requireLeagueAdmin(leagueId)).rejects.toThrow(InternalError);
    });
  });

  describe('authorizeLeagueAdmin', () => {
    it('returns the clients for a league admin', async () => {
      signIn();
      (getLeagueAdminRole as jest.Mock).mockResolvedValue('admin');

      const result = await authorizeLeagueAdmin(LEAGUE_ID);

      expect(result.db).toBe(mockDb);
      expect(result.pg).toBe(mockPg);
      expect(result.user.id).toBe('user-123');
    });

    it('rejects a non-admin', async () => {
      signIn();
      (getLeagueAdminRole as jest.Mock).mockResolvedValue(null);

      await expect(authorizeLeagueAdmin(LEAGUE_ID)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('authorizeLeagueOwner', () => {
    it('returns the clients for the owner', async () => {
      signIn('owner-1');
      (getLeagueAdminRole as jest.Mock).mockResolvedValue('owner');

      const result = await authorizeLeagueOwner(LEAGUE_ID);

      expect(result.db).toBe(mockDb);
      expect(getLeagueAdminRole).toHaveBeenCalledWith(mockPg, LEAGUE_ID, 'owner-1');
    });

    it('rejects a non-owner admin with the given message', async () => {
      signIn();
      (getLeagueAdminRole as jest.Mock).mockResolvedValue('admin');

      await expect(authorizeLeagueOwner(LEAGUE_ID, 'Owners only')).rejects.toThrow('Owners only');
    });

    it('rejects an anonymous caller before creating a privileged client', async () => {
      signOut();

      await expect(authorizeLeagueOwner(LEAGUE_ID)).rejects.toThrow(UnauthorizedError);
      expect(_createPrivilegedClient).not.toHaveBeenCalled();
    });
  });

  describe('authorizeEventAdmin', () => {
    it('checks admin rights on the event league in one lookup', async () => {
      signIn();
      (getEventAccess as jest.Mock).mockResolvedValue(eventAccess({ admin_role: 'admin' }));

      const result = await authorizeEventAdmin(EVENT_ID);

      expect(result.db).toBe(mockDb);
      expect(result.event.league_id).toBe(LEAGUE_ID);
      expect(getEventAccess).toHaveBeenCalledWith(mockPg, EVENT_ID, 'user-123');
    });

    it('rejects an unknown event', async () => {
      signIn();
      (getEventAccess as jest.Mock).mockResolvedValue(null);

      await expect(authorizeEventAdmin(EVENT_ID)).rejects.toThrow(ForbiddenError);
    });

    it('rejects a malformed event id without a query', async () => {
      signIn();

      await expect(authorizeEventAdmin('missing')).rejects.toThrow(ForbiddenError);
      expect(getEventAccess).not.toHaveBeenCalled();
    });

    it('rejects an admin of a different league', async () => {
      signIn();
      (getEventAccess as jest.Mock).mockResolvedValue(eventAccess({ admin_role: null }));

      await expect(authorizeEventAdmin(EVENT_ID)).rejects.toThrow('Insufficient permissions');
    });
  });

  describe('authorizeEventView', () => {
    it('lets an anonymous viewer read a publicly visible event', async () => {
      signOut();
      (getEventAccess as jest.Mock).mockResolvedValue(eventAccess({ status: 'bracket' }));

      const result = await authorizeEventView(EVENT_ID);

      expect(result).toMatchObject({ user: null, isAdmin: false, pg: mockPg });
      expect(getEventAccess).toHaveBeenCalledWith(mockPg, EVENT_ID, null);
    });

    it('hides a private event from anonymous viewers as not found', async () => {
      signOut();
      (getEventAccess as jest.Mock).mockResolvedValue(eventAccess({ status: 'pre-bracket' }));

      await expect(authorizeEventView(EVENT_ID)).rejects.toThrow(NotFoundError);
    });

    it('applies the requested scope', async () => {
      signOut();
      (getEventAccess as jest.Mock).mockResolvedValue(
        eventAccess({ status: 'pre-bracket', qualification_round_enabled: true })
      );

      await expect(authorizeEventView(EVENT_ID, 'qualification')).resolves.toMatchObject({ isAdmin: false });
      await expect(authorizeEventView(EVENT_ID, 'bracket')).rejects.toThrow(NotFoundError);

      (getEventAccess as jest.Mock).mockResolvedValue(eventAccess({ status: 'completed' }));
      await expect(authorizeEventView(EVENT_ID, 'lanes')).rejects.toThrow(NotFoundError);
    });

    it('lets a league admin read a private event', async () => {
      signIn();
      (getEventAccess as jest.Mock).mockResolvedValue(eventAccess({ status: 'created', admin_role: 'owner' }));

      await expect(authorizeEventView(EVENT_ID, 'bracket')).resolves.toMatchObject({ isAdmin: true });
    });

    it('treats an unknown or malformed event id as not found', async () => {
      signIn();
      (getEventAccess as jest.Mock).mockResolvedValue(null);

      await expect(authorizeEventView(EVENT_ID)).rejects.toThrow(NotFoundError);
      await expect(authorizeEventView('nope')).rejects.toThrow(NotFoundError);
      expect(getEventAccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('getViewer', () => {
    it('returns null for anonymous visitors', async () => {
      signOut();
      await expect(getViewer()).resolves.toBeNull();
    });
  });

  describe('authorizeAnyLeagueAdmin', () => {
    it('allows an admin of any league', async () => {
      signIn();
      (isAnyLeagueAdmin as jest.Mock).mockResolvedValue(true);

      await expect(authorizeAnyLeagueAdmin()).resolves.toMatchObject({ db: mockDb });
      expect(isAnyLeagueAdmin).toHaveBeenCalledWith(mockPg, 'user-123');
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
