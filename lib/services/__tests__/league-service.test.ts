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

jest.mock('@/lib/repositories/bracket-repository.db', () => ({
  getBracketProgressRows: jest.fn(async () => new Map()),
}));

jest.mock('@/lib/repositories/event-repository.db', () => ({
  getEventsByLeagueIds: jest.fn(async () => []),
}));

jest.mock('@/lib/repositories/lane-repository.db', () => ({
  getBorrowedLaneLabels: jest.fn(async () => new Map()),
}));

jest.mock('@/lib/repositories/league-repository.db', () => ({
  getAllLeagues: jest.fn(),
  getLeagueWithEvents: jest.fn(),
  getLeagueById: jest.fn(),
  getLeagueAdminsForUser: jest.fn(),
  getLeaguesByIds: jest.fn(),
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
import * as bracketRepo from '@/lib/repositories/bracket-repository.db';
import * as eventRepo from '@/lib/repositories/event-repository.db';
import * as laneRepo from '@/lib/repositories/lane-repository.db';
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
    const summaryEvent = (id: string, event_date: string, status: string, extra: Record<string, unknown> = {}) => ({
      id, event_date, status, parent_event_id: null, link_type: null,
      qualification_round_enabled: false, double_grand_final: true, ...extra,
    });
    const oneMatch = {
      groups: [{ id: 1, number: 1 }],
      rounds: [{ id: 1, group_id: 1, number: 1 }],
      matches: [{ round_id: 1, status: 4, opponent1: { id: 1 }, opponent2: { id: 2 } }],
    };

    it('lists visible leagues for an anonymous viewer with their season', async () => {
      (leagueRepo.getAllLeagues as jest.Mock).mockResolvedValue([{
        id: leagueId, name: 'League', city: 'Ames',
        events: [summaryEvent('b', '2026-10-08', 'completed'), summaryEvent('a', '2026-10-01', 'completed')],
      }]);

      await expect(getPublicLeagues()).resolves.toEqual([{
        id: leagueId, name: 'League', city: 'Ames', event_count: 2, status: 'idle', live_events: [],
        season: { first_event_date: '2026-10-01', latest_event_date: '2026-10-08', night_count: 2, nights: ['done', 'done'] },
      }]);
      expect(leagueRepo.getAllLeagues).toHaveBeenCalledWith(mockPg, null);
    });

    it('puts live leagues first with the live night\'s bracket progress, main event first', async () => {
      (leagueRepo.getAllLeagues as jest.Mock).mockResolvedValue([
        { id: 'idle', name: 'A idle', city: null, events: [summaryEvent('i', '2026-11-20', 'completed')] },
        { id: 'qual', name: 'B qualifying', city: null, events: [summaryEvent('q', '2026-11-01', 'pre-bracket', { qualification_round_enabled: true })] },
        {
          id: 'live', name: 'C live', city: null,
          events: [
            summaryEvent('sc', '2026-10-08', 'bracket', { parent_event_id: 'main', link_type: 'second_chance' }),
            summaryEvent('main', '2026-10-08', 'bracket'),
          ],
        },
      ]);
      (bracketRepo.getBracketProgressRows as jest.Mock).mockResolvedValue(new Map([['main', oneMatch]]));

      const leagues = await getPublicLeagues();

      expect(leagues.map((league) => [league.id, league.status])).toEqual([
        ['live', 'live'], ['qual', 'qualifying'], ['idle', 'idle'],
      ]);
      expect(bracketRepo.getBracketProgressRows).toHaveBeenCalledWith(mockPg, ['main', 'sc']);
      expect(leagues[0].live_events).toEqual([
        { id: 'main', second_chance: false, match_progress: { played: 1, total: 1 } },
        { id: 'sc', second_chance: true, match_progress: null },
      ]);
      expect(leagues[0].season.nights).toEqual(['live']);
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

    it('adds match progress only to events in bracket play', async () => {
      (leagueRepo.getLeagueWithEvents as jest.Mock).mockResolvedValue({
        id: leagueId, name: 'League', city: null, event_count: 2,
        events: [{ id: 'live', status: 'bracket' }, { id: 'done', status: 'completed' }],
      });
      (bracketRepo.getBracketProgressRows as jest.Mock).mockResolvedValue(new Map([['live', {
        groups: [{ id: 1, number: 1 }],
        rounds: [{ id: 1, group_id: 1, number: 1 }],
        matches: [{ round_id: 1, status: 4, opponent1: { id: 1 }, opponent2: { id: 2 } }],
      }]]));

      const league = await getPublicLeagueWithEvents(leagueId);

      expect(bracketRepo.getBracketProgressRows).toHaveBeenCalledWith(mockPg, ['live']);
      expect(league.events.map((event) => event.match_progress)).toEqual([{ played: 1, total: 1 }, null]);
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
    const adminEvent = (id: string, league_id: string, event_date: string, status: string, extra: Record<string, unknown> = {}) => ({
      id, league_id, event_date, status, parent_event_id: null, link_type: null, qualification_round_enabled: false,
      double_grand_final: true, participant_count: 4, paid_count: 3, lane_count: 2, entry_fee_per_player: 5, ...extra,
    });

    it('builds each league\'s season and current night from its events', async () => {
      (leagueRepo.getLeagueAdminsForUser as jest.Mock).mockResolvedValue([
        { league_id: leagueId, role: 'owner' },
      ]);
      (leagueRepo.getLeaguesByIds as jest.Mock).mockResolvedValue([
        createMockLeague({ id: leagueId }),
      ]);
      (eventRepo.getEventsByLeagueIds as jest.Mock).mockResolvedValue([
        adminEvent('next2', leagueId, '2026-12-10', 'created'),
        adminEvent('next1', leagueId, '2026-12-03', 'created'),
        adminEvent('done', leagueId, '2026-11-19', 'completed'),
      ]);

      await expect(getUserAdminLeagues()).resolves.toEqual([
        expect.objectContaining({
          id: leagueId,
          role: 'owner',
          eventCount: 3,
          activeEventCount: 2,
          season: { first_event_date: '2026-11-19', latest_event_date: '2026-12-10', night_count: 3, nights: ['done', 'upcoming', 'upcoming'] },
          currentNight: {
            kind: 'next',
            main: expect.objectContaining({ id: 'next1', participant_count: 4, paid_count: 3, match_progress: null }),
            secondChances: [],
          },
        }),
      ]);
      expect(leagueRepo.getLeagueAdminsForUser).toHaveBeenCalledWith(mockPg, user.id);
      expect(eventRepo.getEventsByLeagueIds).toHaveBeenCalledWith(mockPg, [leagueId]);
    });

    it('loads progress and lent lanes only for the current night, and sorts live leagues first', async () => {
      const other = '00000000-0000-4000-8000-000000000004';
      const empty = '00000000-0000-4000-8000-000000000005';
      (leagueRepo.getLeagueAdminsForUser as jest.Mock).mockResolvedValue([
        { league_id: leagueId, role: 'owner' },
        { league_id: other, role: 'admin' },
        { league_id: empty, role: 'owner' },
      ]);
      (leagueRepo.getLeaguesByIds as jest.Mock).mockResolvedValue([
        createMockLeague({ id: empty, name: 'Empty' }),
        createMockLeague({ id: leagueId, name: 'Finished' }),
        createMockLeague({ id: other, name: 'Live' }),
      ]);
      (eventRepo.getEventsByLeagueIds as jest.Mock).mockResolvedValue([
        adminEvent('live-sc', other, '2026-11-24', 'bracket', { parent_event_id: 'live-main', link_type: 'second_chance' }),
        adminEvent('live-main', other, '2026-11-24', 'bracket'),
        adminEvent('old-live', other, '2026-11-17', 'completed'),
        adminEvent('fin', leagueId, '2026-09-29', 'completed'),
      ]);
      (laneRepo.getBorrowedLaneLabels as jest.Mock).mockResolvedValue(new Map([['live-sc', ['Lane 5']]]));

      const leagues = await getUserAdminLeagues();

      expect(leagues.map((league) => [league.name, league.currentNight?.kind ?? null])).toEqual([
        ['Live', 'live'], ['Finished', 'latest'], ['Empty', null],
      ]);
      expect(bracketRepo.getBracketProgressRows).toHaveBeenCalledWith(mockPg, ['live-main', 'live-sc']);
      expect(laneRepo.getBorrowedLaneLabels).toHaveBeenCalledWith(mockPg, ['live-sc']);
      expect(leagues[0].currentNight?.secondChances).toEqual([
        expect.objectContaining({ id: 'live-sc', borrowed_lane_labels: ['Lane 5'] }),
      ]);
      expect(leagues[2]).toEqual(expect.objectContaining({
        eventCount: 0,
        season: { first_event_date: null, latest_event_date: null, night_count: 0, nights: [] },
      }));
    });

    it('returns early when the user administers no leagues', async () => {
      (leagueRepo.getLeagueAdminsForUser as jest.Mock).mockResolvedValue([]);
      await expect(getUserAdminLeagues()).resolves.toEqual([]);
      expect(eventRepo.getEventsByLeagueIds).not.toHaveBeenCalled();
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
