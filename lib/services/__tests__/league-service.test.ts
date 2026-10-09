import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '@/lib/errors';
import { createMockLeague, createMockUser } from './test-utils';

const mockUUID = '00000000-0000-4000-8000-000000000123';
const mockPg = { kind: 'pg' };
const mockTx = { kind: 'tx' };

jest.spyOn(global.crypto, 'randomUUID').mockReturnValue(mockUUID);

jest.mock('@/lib/services/auth', () => ({
  authorizeAuthenticated: jest.fn(),
  authorizeLeagueCreation: jest.fn(),
  authorizeLeagueOwner: jest.fn(),
  authorizePublicRead: jest.fn(),
  getViewer: jest.fn(),
}));

jest.mock('@/lib/db/tx', () => ({
  withTransaction: jest.fn(),
}));

jest.mock('@/lib/repositories/league-repository.db', () => ({
  getAllLeagues: jest.fn(),
  getLeagueWithEvents: jest.fn(),
  getLeagueById: jest.fn(),
  getLeagueAdminsForUser: jest.fn(),
  getLeaguesByIds: jest.fn(),
  getLeagueEventStats: jest.fn(),
  insertLeague: jest.fn(),
  insertLeagueAdmin: jest.fn(),
  fetchLeague: jest.fn(),
  getLeagueAdminsWithEmails: jest.fn(),
  getLeagueAdminRole: jest.fn(),
  getUserIdByEmail: jest.fn(),
  getLeagueAdminByUserAndLeague: jest.fn(),
  deleteLeagueAdmin: jest.fn(),
  deleteLeague: jest.fn(),
}));

import { withTransaction } from '@/lib/db/tx';
import {
  authorizeAuthenticated,
  authorizeLeagueCreation,
  authorizeLeagueOwner,
  authorizePublicRead,
  getViewer,
} from '@/lib/services/auth';
import * as leagueRepo from '@/lib/repositories/league-repository.db';
import {
  addLeagueAdmin,
  checkIsLeagueOwner,
  createLeague,
  deleteLeague,
  getLeague,
  getLeagueAdminsForOwner,
  getPublicLeagues,
  getPublicLeagueWithEvents,
  getUserAdminLeagues,
  removeLeagueAdmin,
} from '../league/league-service';

const user = createMockUser({ id: '00000000-0000-4000-8000-000000000001' });
const leagueId = '00000000-0000-4000-8000-000000000002';
const targetUserId = '00000000-0000-4000-8000-000000000003';

describe('League Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authorizePublicRead as jest.Mock).mockReturnValue({ pg: mockPg });
    (getViewer as jest.Mock).mockResolvedValue(null);
    (authorizeAuthenticated as jest.Mock).mockResolvedValue({ user, pg: mockPg });
    (authorizeLeagueCreation as jest.Mock).mockResolvedValue({ user, pg: mockPg });
    (authorizeLeagueOwner as jest.Mock).mockResolvedValue({ user, pg: mockPg });
    (withTransaction as jest.Mock).mockImplementation(
      (_pg: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)
    );
  });

  describe('public reads', () => {
    it('lists visible leagues for an anonymous viewer', async () => {
      const leagues = [{ id: leagueId, name: 'League', event_count: 1 }];
      (leagueRepo.getAllLeagues as jest.Mock).mockResolvedValue(leagues);

      await expect(getPublicLeagues()).resolves.toEqual(leagues);
      expect(leagueRepo.getAllLeagues).toHaveBeenCalledWith(mockPg, null);
    });

    it('passes the signed-in viewer to public league visibility queries', async () => {
      (getViewer as jest.Mock).mockResolvedValue(user);
      (leagueRepo.getLeagueWithEvents as jest.Mock).mockResolvedValue({
        id: leagueId,
        name: 'League',
        event_count: 0,
        events: [],
      });

      await getPublicLeagueWithEvents(leagueId);
      expect(leagueRepo.getLeagueWithEvents).toHaveBeenCalledWith(mockPg, leagueId, user.id);
    });

    it('throws not found for a hidden or missing public league detail', async () => {
      (leagueRepo.getLeagueWithEvents as jest.Mock).mockResolvedValue(null);
      await expect(getPublicLeagueWithEvents(leagueId)).rejects.toThrow(NotFoundError);
    });

    it('does not query league detail for a malformed id', async () => {
      await expect(getPublicLeagueWithEvents('bad-id')).rejects.toThrow(NotFoundError);
      expect(leagueRepo.getLeagueWithEvents).not.toHaveBeenCalled();
    });
  });

  describe('getLeague', () => {
    it('uses the public database authorization', async () => {
      const league = createMockLeague({ id: leagueId });
      (leagueRepo.getLeagueById as jest.Mock).mockResolvedValue(league);

      await expect(getLeague(leagueId)).resolves.toEqual(league);
      expect(authorizePublicRead).toHaveBeenCalled();
      expect(leagueRepo.getLeagueById).toHaveBeenCalledWith(mockPg, leagueId);
    });

    it('returns null without querying Postgres for a malformed id', async () => {
      await expect(getLeague('bad-id')).resolves.toBeNull();
      expect(leagueRepo.getLeagueById).not.toHaveBeenCalled();
    });
  });

  describe('getUserAdminLeagues', () => {
    it('uses the authenticated user and grouped event stats', async () => {
      (leagueRepo.getLeagueAdminsForUser as jest.Mock).mockResolvedValue([
        { league_id: leagueId, role: 'owner' },
      ]);
      (leagueRepo.getLeaguesByIds as jest.Mock).mockResolvedValue([
        createMockLeague({ id: leagueId }),
      ]);
      (leagueRepo.getLeagueEventStats as jest.Mock).mockResolvedValue([
        {
          league_id: leagueId,
          event_count: 4,
          active_event_count: 2,
          last_event_date: '2026-10-09',
        },
      ]);

      await expect(getUserAdminLeagues()).resolves.toEqual([
        expect.objectContaining({
          id: leagueId,
          role: 'owner',
          eventCount: 4,
          activeEventCount: 2,
          lastEventDate: '2026-10-09',
        }),
      ]);
      expect(leagueRepo.getLeagueAdminsForUser).toHaveBeenCalledWith(mockPg, user.id);
      expect(leagueRepo.getLeagueEventStats).toHaveBeenCalledWith(mockPg, [leagueId]);
    });

    it('returns early when the user administers no leagues', async () => {
      (leagueRepo.getLeagueAdminsForUser as jest.Mock).mockResolvedValue([]);
      await expect(getUserAdminLeagues()).resolves.toEqual([]);
      expect(leagueRepo.getLeagueEventStats).not.toHaveBeenCalled();
    });

    it('rejects anonymous users before querying', async () => {
      (authorizeAuthenticated as jest.Mock).mockRejectedValue(new UnauthorizedError());
      await expect(getUserAdminLeagues()).rejects.toThrow(UnauthorizedError);
      expect(leagueRepo.getLeagueAdminsForUser).not.toHaveBeenCalled();
    });
  });

  describe('createLeague', () => {
    it('inserts the league, owner, and read-back in one transaction', async () => {
      const league = createMockLeague({ id: mockUUID, name: 'New League', city: 'Madison' });
      (leagueRepo.fetchLeague as jest.Mock).mockResolvedValue(league);

      await expect(createLeague({ name: 'New League', city: 'Madison' })).resolves.toEqual(league);
      expect(withTransaction).toHaveBeenCalledWith(mockPg, expect.any(Function));
      expect(leagueRepo.insertLeague).toHaveBeenCalledWith(
        mockTx,
        mockUUID,
        'New League',
        'Madison'
      );
      expect(leagueRepo.insertLeagueAdmin).toHaveBeenCalledWith(
        mockTx,
        mockUUID,
        user.id,
        'owner'
      );
      expect(leagueRepo.fetchLeague).toHaveBeenCalledWith(mockTx, mockUUID);
    });

    it('rejects an invalid name before opening a transaction', async () => {
      await expect(createLeague({ name: '' })).rejects.toThrow(BadRequestError);
      expect(withTransaction).not.toHaveBeenCalled();
    });

    it('rejects anonymous users before writing', async () => {
      (authorizeLeagueCreation as jest.Mock).mockRejectedValue(new UnauthorizedError());
      await expect(createLeague({ name: 'League' })).rejects.toThrow(UnauthorizedError);
      expect(leagueRepo.insertLeague).not.toHaveBeenCalled();
    });
  });

  describe('getLeagueAdminsForOwner', () => {
    it('returns joined admin emails and preserves the Unknown fallback', async () => {
      (leagueRepo.getLeagueAdminsWithEmails as jest.Mock).mockResolvedValue([
        { user_id: user.id, role: 'owner', email: 'owner@example.test' },
        { user_id: targetUserId, role: 'admin', email: null },
      ]);

      await expect(getLeagueAdminsForOwner(leagueId)).resolves.toEqual([
        { userId: user.id, role: 'owner', email: 'owner@example.test' },
        { userId: targetUserId, role: 'admin', email: 'Unknown' },
      ]);
      expect(leagueRepo.getLeagueAdminsWithEmails).toHaveBeenCalledWith(mockPg, leagueId);
    });

    it('rejects a non-owner before querying admins', async () => {
      (authorizeLeagueOwner as jest.Mock).mockRejectedValue(new ForbiddenError());
      await expect(getLeagueAdminsForOwner(leagueId)).rejects.toThrow(ForbiddenError);
      expect(leagueRepo.getLeagueAdminsWithEmails).not.toHaveBeenCalled();
    });
  });

  describe('checkIsLeagueOwner', () => {
    it('checks the authenticated user role', async () => {
      (leagueRepo.getLeagueAdminRole as jest.Mock).mockResolvedValue('owner');
      await expect(checkIsLeagueOwner(leagueId)).resolves.toBe(true);
      expect(leagueRepo.getLeagueAdminRole).toHaveBeenCalledWith(mockPg, leagueId, user.id);
    });

    it('returns false for a malformed id without querying', async () => {
      await expect(checkIsLeagueOwner('bad-id')).resolves.toBe(false);
      expect(leagueRepo.getLeagueAdminRole).not.toHaveBeenCalled();
    });

    it('rejects anonymous users before querying', async () => {
      (authorizeAuthenticated as jest.Mock).mockRejectedValue(new UnauthorizedError());
      await expect(checkIsLeagueOwner(leagueId)).rejects.toThrow(UnauthorizedError);
      expect(leagueRepo.getLeagueAdminRole).not.toHaveBeenCalled();
    });
  });

  describe('owner writes', () => {
    it('adds a normalized email after checking existence inside one transaction', async () => {
      (leagueRepo.getUserIdByEmail as jest.Mock).mockResolvedValue(targetUserId);
      (leagueRepo.getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue(null);

      await addLeagueAdmin(leagueId, '  NewAdmin@Example.TEST ');
      expect(leagueRepo.getUserIdByEmail).toHaveBeenCalledWith(mockTx, 'newadmin@example.test');
      expect(leagueRepo.getLeagueAdminByUserAndLeague).toHaveBeenCalledWith(
        mockTx,
        leagueId,
        targetUserId
      );
      expect(leagueRepo.insertLeagueAdmin).toHaveBeenCalledWith(
        mockTx,
        leagueId,
        targetUserId,
        'admin'
      );
    });

    it('rejects invalid admin emails', async () => {
      await expect(addLeagueAdmin(leagueId, 'invalid')).rejects.toThrow(BadRequestError);
      expect(withTransaction).not.toHaveBeenCalled();
    });

    it('rejects unknown accounts', async () => {
      (leagueRepo.getUserIdByEmail as jest.Mock).mockResolvedValue(null);
      await expect(addLeagueAdmin(leagueId, 'missing@example.test')).rejects.toThrow(NotFoundError);
    });

    it('rejects an existing admin', async () => {
      (leagueRepo.getUserIdByEmail as jest.Mock).mockResolvedValue(targetUserId);
      (leagueRepo.getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue({ id: 'admin-id' });
      await expect(addLeagueAdmin(leagueId, 'admin@example.test')).rejects.toThrow(BadRequestError);
    });

    it('uses owner-authorized pg for deletion', async () => {
      await deleteLeague(leagueId);
      expect(leagueRepo.deleteLeague).toHaveBeenCalledWith(mockPg, leagueId);
    });

    it('removes another admin with owner-authorized pg', async () => {
      await removeLeagueAdmin(leagueId, targetUserId);
      expect(leagueRepo.deleteLeagueAdmin).toHaveBeenCalledWith(mockPg, leagueId, targetUserId);
    });

    it('does not let the owner remove themselves', async () => {
      await expect(removeLeagueAdmin(leagueId, user.id)).rejects.toThrow(BadRequestError);
      expect(leagueRepo.deleteLeagueAdmin).not.toHaveBeenCalled();
    });

    it.each([
      ['add', () => addLeagueAdmin(leagueId, 'admin@example.test')],
      ['remove', () => removeLeagueAdmin(leagueId, targetUserId)],
      ['delete', () => deleteLeague(leagueId)],
    ])('rejects a non-owner before the %s write', async (_name, action) => {
      (authorizeLeagueOwner as jest.Mock).mockRejectedValue(new ForbiddenError());
      await expect(action()).rejects.toThrow(ForbiddenError);
      expect(leagueRepo.insertLeagueAdmin).not.toHaveBeenCalled();
      expect(leagueRepo.deleteLeagueAdmin).not.toHaveBeenCalled();
      expect(leagueRepo.deleteLeague).not.toHaveBeenCalled();
    });
  });
});
