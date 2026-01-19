/**
 * League Service Tests
 *
 * Tests for league management functions:
 * - getLeague()
 * - getUserAdminLeagues()
 * - createLeague()
 * - getLeagueAdminsForOwner()
 * - checkIsLeagueOwner()
 * - addLeagueAdmin()
 * - removeLeagueAdmin()
 */

import { UnauthorizedError, BadRequestError, ForbiddenError, NotFoundError } from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockUser,
  createMockLeague,
  createMockLeagueAdmin,
  MockSupabaseClient,
} from './test-utils';

// Mock crypto.randomUUID
const mockUUID = 'generated-uuid-123';
const randomUuidSpy = jest
  .spyOn(global.crypto, 'randomUUID')
  .mockReturnValue(mockUUID);
afterAll(() => {
  randomUuidSpy.mockRestore();
});

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/services/auth', () => ({
  requireAuthenticatedUser: jest.fn(),
}));

jest.mock('@/lib/repositories/league-repository', () => ({
  getLeagueById: jest.fn(),
  getLeagueAdminsForUser: jest.fn(),
  getLeaguesByIds: jest.fn(),
  getEventCountForLeague: jest.fn(),
  getActiveEventCountForLeague: jest.fn(),
  getLastEventDateForLeague: jest.fn(),
  insertLeague: jest.fn(),
  insertLeagueAdmin: jest.fn(),
  fetchLeague: jest.fn(),
  isLeagueOwner: jest.fn(),
  getLeagueAdmins: jest.fn(),
  getUserEmailById: jest.fn(),
  getUserIdByEmail: jest.fn(),
  getLeagueAdminByUserAndLeague: jest.fn(),
  deleteLeagueAdmin: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { requireAuthenticatedUser } from '@/lib/services/auth';
import * as leagueRepo from '@/lib/repositories/league-repository';
import {
  getLeague,
  getUserAdminLeagues,
  createLeague,
  getLeagueAdminsForOwner,
  checkIsLeagueOwner,
  addLeagueAdmin,
  removeLeagueAdmin,
} from '../league/league-service';

describe('League Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('getLeague', () => {
    it('should return a league by ID', async () => {
      const mockLeague = createMockLeague({ id: 'league-123', name: 'Test League' });
      (leagueRepo.getLeagueById as jest.Mock).mockResolvedValue(mockLeague);

      const result = await getLeague('league-123');

      expect(result).toEqual(mockLeague);
      expect(leagueRepo.getLeagueById).toHaveBeenCalledWith(mockSupabase, 'league-123');
    });

    it('should return null when league not found', async () => {
      (leagueRepo.getLeagueById as jest.Mock).mockResolvedValue(null);

      const result = await getLeague('non-existent-league');

      expect(result).toBeNull();
    });
  });

  describe('getUserAdminLeagues', () => {
    const userId = 'user-123';

    it('should return empty array when user has no admin records', async () => {
      (leagueRepo.getLeagueAdminsForUser as jest.Mock).mockResolvedValue([]);

      const result = await getUserAdminLeagues(userId);

      expect(result).toEqual([]);
      expect(leagueRepo.getLeaguesByIds).not.toHaveBeenCalled();
    });

    it('should return leagues with enriched data', async () => {
      const adminRecords = [
        createMockLeagueAdmin({ league_id: 'league-1', user_id: userId, role: 'owner' }),
        createMockLeagueAdmin({ league_id: 'league-2', user_id: userId, role: 'admin' }),
      ];
      const leagues = [
        createMockLeague({ id: 'league-1', name: 'League One' }),
        createMockLeague({ id: 'league-2', name: 'League Two' }),
      ];

      (leagueRepo.getLeagueAdminsForUser as jest.Mock).mockResolvedValue(adminRecords);
      (leagueRepo.getLeaguesByIds as jest.Mock).mockResolvedValue(leagues);
      (leagueRepo.getEventCountForLeague as jest.Mock)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(3);
      (leagueRepo.getActiveEventCountForLeague as jest.Mock)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);
      (leagueRepo.getLastEventDateForLeague as jest.Mock)
        .mockResolvedValueOnce('2024-06-01')
        .mockResolvedValueOnce('2024-05-15');

      const result = await getUserAdminLeagues(userId);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'league-1',
        name: 'League One',
        role: 'owner',
        eventCount: 5,
        activeEventCount: 2,
        lastEventDate: '2024-06-01',
      });
      expect(result[1]).toMatchObject({
        id: 'league-2',
        name: 'League Two',
        role: 'admin',
        eventCount: 3,
        activeEventCount: 1,
        lastEventDate: '2024-05-15',
      });
    });

    it('should use default admin role when role is not found', async () => {
      const adminRecords = [
        { ...createMockLeagueAdmin({ league_id: 'league-1' }), role: undefined },
      ];
      const leagues = [createMockLeague({ id: 'league-1' })];

      (leagueRepo.getLeagueAdminsForUser as jest.Mock).mockResolvedValue(adminRecords);
      (leagueRepo.getLeaguesByIds as jest.Mock).mockResolvedValue(leagues);
      (leagueRepo.getEventCountForLeague as jest.Mock).mockResolvedValue(0);
      (leagueRepo.getActiveEventCountForLeague as jest.Mock).mockResolvedValue(0);
      (leagueRepo.getLastEventDateForLeague as jest.Mock).mockResolvedValue(null);

      const result = await getUserAdminLeagues(userId);

      expect(result[0].role).toBe('admin');
    });

    it('should handle null lastEventDate', async () => {
      const adminRecords = [createMockLeagueAdmin({ league_id: 'league-1' })];
      const leagues = [createMockLeague({ id: 'league-1' })];

      (leagueRepo.getLeagueAdminsForUser as jest.Mock).mockResolvedValue(adminRecords);
      (leagueRepo.getLeaguesByIds as jest.Mock).mockResolvedValue(leagues);
      (leagueRepo.getEventCountForLeague as jest.Mock).mockResolvedValue(0);
      (leagueRepo.getActiveEventCountForLeague as jest.Mock).mockResolvedValue(0);
      (leagueRepo.getLastEventDateForLeague as jest.Mock).mockResolvedValue(null);

      const result = await getUserAdminLeagues(userId);

      expect(result[0].lastEventDate).toBeNull();
    });
  });

  describe('createLeague', () => {
    beforeEach(() => {
      const mockUser = createMockUser({ id: 'user-123' });
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(mockUser);
    });

    it('should create a league with name and city', async () => {
      const expectedLeague = createMockLeague({
        id: mockUUID,
        name: 'New League',
        city: 'New York',
      });

      (leagueRepo.insertLeague as jest.Mock).mockResolvedValue(undefined);
      (leagueRepo.insertLeagueAdmin as jest.Mock).mockResolvedValue(undefined);
      (leagueRepo.fetchLeague as jest.Mock).mockResolvedValue(expectedLeague);

      const result = await createLeague({ name: 'New League', city: 'New York' });

      expect(result).toEqual(expectedLeague);
      expect(requireAuthenticatedUser).toHaveBeenCalled();
      expect(leagueRepo.insertLeague).toHaveBeenCalledWith(
        mockSupabase,
        mockUUID,
        'New League',
        'New York'
      );
      expect(leagueRepo.insertLeagueAdmin).toHaveBeenCalledWith(
        mockSupabase,
        mockUUID,
        'user-123',
        'owner'
      );
      expect(leagueRepo.fetchLeague).toHaveBeenCalledWith(mockSupabase, mockUUID);
    });

    it('should create a league without city', async () => {
      const expectedLeague = createMockLeague({
        id: mockUUID,
        name: 'League No City',
        city: null,
      });

      (leagueRepo.insertLeague as jest.Mock).mockResolvedValue(undefined);
      (leagueRepo.insertLeagueAdmin as jest.Mock).mockResolvedValue(undefined);
      (leagueRepo.fetchLeague as jest.Mock).mockResolvedValue(expectedLeague);

      const result = await createLeague({ name: 'League No City' });

      expect(result).toEqual(expectedLeague);
      expect(leagueRepo.insertLeague).toHaveBeenCalledWith(
        mockSupabase,
        mockUUID,
        'League No City',
        null
      );
    });

    it('should handle null city explicitly', async () => {
      (leagueRepo.insertLeague as jest.Mock).mockResolvedValue(undefined);
      (leagueRepo.insertLeagueAdmin as jest.Mock).mockResolvedValue(undefined);
      (leagueRepo.fetchLeague as jest.Mock).mockResolvedValue(createMockLeague());

      await createLeague({ name: 'Test', city: null });

      expect(leagueRepo.insertLeague).toHaveBeenCalledWith(
        mockSupabase,
        mockUUID,
        'Test',
        null
      );
    });

    it('should throw UnauthorizedError when not authenticated', async () => {
      (requireAuthenticatedUser as jest.Mock).mockRejectedValue(
        new UnauthorizedError('Authentication required')
      );

      await expect(createLeague({ name: 'Test League' })).rejects.toThrow(UnauthorizedError);
      await expect(createLeague({ name: 'Test League' })).rejects.toThrow('Authentication required');
    });

    it('should throw BadRequestError when name is missing', async () => {
      await expect(createLeague({ name: '' })).rejects.toThrow(BadRequestError);
      await expect(createLeague({ name: '' })).rejects.toThrow('League name is required');
    });

    it('should throw BadRequestError when name is not a string', async () => {
      await expect(createLeague({ name: 123 as unknown as string })).rejects.toThrow(
        BadRequestError
      );
    });

    it('should generate a unique UUID for each league', async () => {
      (leagueRepo.insertLeague as jest.Mock).mockResolvedValue(undefined);
      (leagueRepo.insertLeagueAdmin as jest.Mock).mockResolvedValue(undefined);
      (leagueRepo.fetchLeague as jest.Mock).mockResolvedValue(createMockLeague());

      await createLeague({ name: 'League 1' });

      expect(crypto.randomUUID).toHaveBeenCalled();
      expect(leagueRepo.insertLeague).toHaveBeenCalledWith(
        mockSupabase,
        mockUUID,
        'League 1',
        null
      );
    });

    it('should set the creating user as owner', async () => {
      const ownerId = 'owner-user-456';
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(createMockUser({ id: ownerId }));

      (leagueRepo.insertLeague as jest.Mock).mockResolvedValue(undefined);
      (leagueRepo.insertLeagueAdmin as jest.Mock).mockResolvedValue(undefined);
      (leagueRepo.fetchLeague as jest.Mock).mockResolvedValue(createMockLeague());

      await createLeague({ name: 'Test' });

      expect(leagueRepo.insertLeagueAdmin).toHaveBeenCalledWith(
        mockSupabase,
        mockUUID,
        ownerId,
        'owner'
      );
    });
  });

  describe('getLeagueAdminsForOwner', () => {
    const leagueId = 'league-123';
    const userId = 'user-123';

    beforeEach(() => {
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(createMockUser({ id: userId }));
    });

    it('should return admins with emails for owner', async () => {
      (leagueRepo.isLeagueOwner as jest.Mock).mockResolvedValue(true);
      
      const mockAdmins = [
        createMockLeagueAdmin({ user_id: 'admin-1', role: 'owner' }),
        createMockLeagueAdmin({ user_id: 'admin-2', role: 'admin' }),
      ];
      (leagueRepo.getLeagueAdmins as jest.Mock).mockResolvedValue(mockAdmins);
      
      (leagueRepo.getUserEmailById as jest.Mock)
        .mockResolvedValueOnce('admin1@test.com')
        .mockResolvedValueOnce('admin2@test.com');

      const result = await getLeagueAdminsForOwner(leagueId);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        userId: 'admin-1',
        email: 'admin1@test.com',
        role: 'owner',
      });
      expect(result[1]).toEqual({
        userId: 'admin-2',
        email: 'admin2@test.com',
        role: 'admin',
      });
    });

    it('should handle missing emails', async () => {
      (leagueRepo.isLeagueOwner as jest.Mock).mockResolvedValue(true);
      
      const mockAdmins = [createMockLeagueAdmin({ user_id: 'admin-1' })];
      (leagueRepo.getLeagueAdmins as jest.Mock).mockResolvedValue(mockAdmins);
      (leagueRepo.getUserEmailById as jest.Mock).mockResolvedValue(null);

      const result = await getLeagueAdminsForOwner(leagueId);

      expect(result[0].email).toBe('Unknown');
    });

    it('should throw ForbiddenError if not owner', async () => {
      (leagueRepo.isLeagueOwner as jest.Mock).mockResolvedValue(false);

      await expect(getLeagueAdminsForOwner(leagueId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('checkIsLeagueOwner', () => {
    const leagueId = 'league-123';
    const userId = 'user-123';

    it('should return true if user is owner', async () => {
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(createMockUser({ id: userId }));
      (leagueRepo.isLeagueOwner as jest.Mock).mockResolvedValue(true);

      const result = await checkIsLeagueOwner(leagueId);

      expect(result).toBe(true);
      expect(leagueRepo.isLeagueOwner).toHaveBeenCalledWith(mockSupabase, leagueId, userId);
    });

    it('should return false if user is not owner', async () => {
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(createMockUser({ id: userId }));
      (leagueRepo.isLeagueOwner as jest.Mock).mockResolvedValue(false);

      const result = await checkIsLeagueOwner(leagueId);

      expect(result).toBe(false);
    });
  });

  describe('addLeagueAdmin', () => {
    const leagueId = 'league-123';
    const userId = 'user-123';
    const newAdminEmail = 'newadmin@test.com';
    const newAdminId = 'user-456';

    beforeEach(() => {
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(createMockUser({ id: userId }));
      (leagueRepo.isLeagueOwner as jest.Mock).mockResolvedValue(true);
      (leagueRepo.getUserIdByEmail as jest.Mock).mockResolvedValue(newAdminId);
      (leagueRepo.getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue(null);
    });

    it('should add a new admin', async () => {
      await addLeagueAdmin(leagueId, newAdminEmail);

      expect(leagueRepo.insertLeagueAdmin).toHaveBeenCalledWith(
        mockSupabase,
        leagueId,
        newAdminId,
        'admin'
      );
    });

    it('should throw ForbiddenError if not owner', async () => {
      (leagueRepo.isLeagueOwner as jest.Mock).mockResolvedValue(false);

      await expect(addLeagueAdmin(leagueId, newAdminEmail)).rejects.toThrow(ForbiddenError);
    });

    it('should throw BadRequestError for invalid email', async () => {
      await expect(addLeagueAdmin(leagueId, 'invalid-email')).rejects.toThrow(BadRequestError);
    });

    it('should throw NotFoundError if user not found', async () => {
      (leagueRepo.getUserIdByEmail as jest.Mock).mockResolvedValue(null);

      await expect(addLeagueAdmin(leagueId, newAdminEmail)).rejects.toThrow(NotFoundError);
    });

    it('should throw BadRequestError if user is already admin', async () => {
      (leagueRepo.getLeagueAdminByUserAndLeague as jest.Mock).mockResolvedValue(
        createMockLeagueAdmin()
      );

      await expect(addLeagueAdmin(leagueId, newAdminEmail)).rejects.toThrow(BadRequestError);
    });
  });

  describe('removeLeagueAdmin', () => {
    const leagueId = 'league-123';
    const userId = 'user-123';
    const targetUserId = 'user-456';

    beforeEach(() => {
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(createMockUser({ id: userId }));
      (leagueRepo.isLeagueOwner as jest.Mock).mockResolvedValue(true);
    });

    it('should remove an admin', async () => {
      await removeLeagueAdmin(leagueId, targetUserId);

      expect(leagueRepo.deleteLeagueAdmin).toHaveBeenCalledWith(
        mockSupabase,
        leagueId,
        targetUserId
      );
    });

    it('should throw ForbiddenError if not owner', async () => {
      (leagueRepo.isLeagueOwner as jest.Mock).mockResolvedValue(false);

      await expect(removeLeagueAdmin(leagueId, targetUserId)).rejects.toThrow(ForbiddenError);
    });

    it('should throw BadRequestError if removing self', async () => {
      await expect(removeLeagueAdmin(leagueId, userId)).rejects.toThrow(BadRequestError);
    });
  });
});