/**
 * Team Repository Tests
 *
 * Tests for team data access including:
 * - Team CRUD operations
 * - Team member management
 * - Participant-to-team lookups
 * - Bulk operations
 * - Membership verification
 */

import {
  createMockSupabaseClient,
  createMockQueryBuilder,
  MockSupabaseClient,
} from '@/lib/services/__tests__/test-utils';
import { InternalError } from '@/lib/errors';

// Mock server-only before importing repository
jest.mock('server-only', () => ({}));

import {
  getTeamFromParticipant,
  getPublicTeamFromParticipant,
  verifyPlayerInTeams,
  verifyPlayersInTeams,
  getTeamIdsFromParticipants,
  getTeamsForEvent,
  insertTeam,
  insertTeamMember,
  getTeamsWithMembersForEvent,
  updateTeamSeed,
  getFullTeamsForEvent,
  insertTeamsBulk,
  insertTeamMembersBulk,
} from '../team-repository';

describe('Team Repository', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
  });

  describe('getTeamFromParticipant', () => {
    it('should return null for null participantId', async () => {
      const result = await getTeamFromParticipant(mockSupabase as any, null);

      expect(result).toBeNull();
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should return team with players from participant', async () => {
      const mockParticipant = {
        team_id: 'team-1',
        team: {
          id: 'team-1',
          seed: 1,
          pool_combo: 'Player A & Player B',
          team_members: [
            {
              event_player_id: 'ep-1',
              role: 'A_pool',
              event_player: {
                id: 'ep-1',
                player: { id: 'p1', full_name: 'Player A', nickname: 'PA' },
              },
            },
            {
              event_player_id: 'ep-2',
              role: 'B_pool',
              event_player: {
                id: 'ep-2',
                player: { id: 'p2', full_name: 'Player B', nickname: 'PB' },
              },
            },
          ],
        },
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: mockParticipant, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getTeamFromParticipant(mockSupabase as any, 1);

      expect(result).toEqual({
        id: 'team-1',
        seed: 1,
        pool_combo: 'Player A & Player B',
        players: [
          {
            event_player_id: 'ep-1',
            role: 'A_pool',
            player: { id: 'p1', full_name: 'Player A', nickname: 'PA' },
          },
          {
            event_player_id: 'ep-2',
            role: 'B_pool',
            player: { id: 'p2', full_name: 'Player B', nickname: 'PB' },
          },
        ],
      });
    });

    it('should return null when team not found', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: { team: null }, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getTeamFromParticipant(mockSupabase as any, 999);

      expect(result).toBeNull();
    });
  });

  describe('getPublicTeamFromParticipant', () => {
    it('should return null for null participantId', async () => {
      const result = await getPublicTeamFromParticipant(mockSupabase as any, null);

      expect(result).toBeNull();
    });

    it('should return team with limited player info', async () => {
      const mockParticipant = {
        team_id: 'team-1',
        team: {
          id: 'team-1',
          seed: 1,
          pool_combo: 'Player A & Player B',
          team_members: [
            {
              event_player_id: 'ep-1',
              role: 'A_pool',
              event_player: {
                player: { full_name: 'Player A', nickname: 'PA' },
              },
            },
          ],
        },
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: mockParticipant, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPublicTeamFromParticipant(mockSupabase as any, 1);

      expect(result).toEqual({
        id: 'team-1',
        seed: 1,
        pool_combo: 'Player A & Player B',
        players: [
          {
            event_player_id: 'ep-1',
            role: 'A_pool',
            full_name: 'Player A',
            nickname: 'PA',
          },
        ],
      });
    });
  });

  describe('verifyPlayerInTeams', () => {
    it('should return false for empty teamIds', async () => {
      const result = await verifyPlayerInTeams(mockSupabase as any, 'ep-1', []);

      expect(result).toBe(false);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should return true when player is in one of the teams', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.in.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: { team_id: 'team-1' }, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await verifyPlayerInTeams(mockSupabase as any, 'ep-1', ['team-1', 'team-2']);

      expect(result).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('team_members');
    });

    it('should return false when player is not in any team', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.in.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await verifyPlayerInTeams(mockSupabase as any, 'ep-1', ['team-1']);

      expect(result).toBe(false);
    });

    it('should throw InternalError on query failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.in.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        verifyPlayerInTeams(mockSupabase as any, 'ep-1', ['team-1'])
      ).rejects.toThrow(InternalError);
    });
  });

  describe('verifyPlayersInTeams', () => {
    it('should return false for empty inputs', async () => {
      const result1 = await verifyPlayersInTeams(mockSupabase as any, [], ['team-1']);
      const result2 = await verifyPlayersInTeams(mockSupabase as any, ['ep-1'], []);

      expect(result1).toBe(false);
      expect(result2).toBe(false);
    });

    it('should return true when all players are in teams', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      // Chain .in().in()
      let inCount = 0;
      mockQuery.in.mockImplementation(() => {
        inCount++;
        if (inCount === 2) {
          return Promise.resolve({
            data: [{ event_player_id: 'ep-1' }, { event_player_id: 'ep-2' }],
            error: null,
          });
        }
        return mockQuery;
      });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await verifyPlayersInTeams(
        mockSupabase as any,
        ['ep-1', 'ep-2'],
        ['team-1']
      );

      expect(result).toBe(true);
    });

    it('should return false when some players are missing', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      let inCount = 0;
      mockQuery.in.mockImplementation(() => {
        inCount++;
        if (inCount === 2) {
          return Promise.resolve({
            data: [{ event_player_id: 'ep-1' }], // Missing ep-2
            error: null,
          });
        }
        return mockQuery;
      });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await verifyPlayersInTeams(
        mockSupabase as any,
        ['ep-1', 'ep-2'],
        ['team-1']
      );

      expect(result).toBe(false);
    });

    it('should deduplicate player IDs', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      let inCount = 0;
      mockQuery.in.mockImplementation(() => {
        inCount++;
        if (inCount === 2) {
          return Promise.resolve({
            data: [{ event_player_id: 'ep-1' }],
            error: null,
          });
        }
        return mockQuery;
      });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await verifyPlayersInTeams(
        mockSupabase as any,
        ['ep-1', 'ep-1', 'ep-1'], // Duplicates should be deduped
        ['team-1']
      );

      expect(result).toBe(true);
    });
  });

  describe('getTeamIdsFromParticipants', () => {
    it('should return empty array for empty input', async () => {
      const result = await getTeamIdsFromParticipants(mockSupabase as any, []);

      expect(result).toEqual([]);
    });

    it('should return team IDs from participants', async () => {
      const mockParticipants = [
        { team_id: 'team-1' },
        { team_id: 'team-2' },
        { team_id: null },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.in.mockResolvedValue({ data: mockParticipants, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getTeamIdsFromParticipants(mockSupabase as any, [1, 2, 3]);

      expect(result).toEqual(['team-1', 'team-2']);
    });
  });

  describe('getTeamsForEvent', () => {
    it('should return team IDs for an event', async () => {
      const mockTeams = [{ id: 'team-1' }, { id: 'team-2' }];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ data: mockTeams, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getTeamsForEvent(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockTeams);
      expect(mockSupabase.from).toHaveBeenCalledWith('teams');
    });

    it('should throw error on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(getTeamsForEvent(mockSupabase as any, 'event-123')).rejects.toThrow(
        'Query failed'
      );
    });
  });

  describe('insertTeam', () => {
    it('should insert team and return ID', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.insert.mockReturnThis();
      mockQuery.select.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: { id: 'team-new' }, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await insertTeam(mockSupabase as any, 'event-123', 1, 'A & B');

      expect(result).toBe('team-new');
      expect(mockQuery.insert).toHaveBeenCalledWith({
        event_id: 'event-123',
        seed: 1,
        pool_combo: 'A & B',
      });
    });

    it('should throw error on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.insert.mockReturnThis();
      mockQuery.select.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: null, error: { message: 'Insert failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(insertTeam(mockSupabase as any, 'event-123', 1, 'A & B')).rejects.toThrow(
        'Failed to create team'
      );
    });
  });

  describe('insertTeamMember', () => {
    it('should insert team member', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.insert.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await insertTeamMember(mockSupabase as any, 'team-1', 'ep-1', 'A_pool');

      expect(mockSupabase.from).toHaveBeenCalledWith('team_members');
      expect(mockQuery.insert).toHaveBeenCalledWith({
        team_id: 'team-1',
        event_player_id: 'ep-1',
        role: 'A_pool',
      });
    });

    it('should throw error on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.insert.mockResolvedValue({ error: { message: 'Insert failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        insertTeamMember(mockSupabase as any, 'team-1', 'ep-1', 'A_pool')
      ).rejects.toThrow('Failed to create team member');
    });
  });

  describe('getTeamsWithMembersForEvent', () => {
    it('should return teams with their members', async () => {
      const mockTeams = [
        {
          id: 'team-1',
          team_members: [{ event_player_id: 'ep-1' }, { event_player_id: 'ep-2' }],
        },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ data: mockTeams, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getTeamsWithMembersForEvent(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockTeams);
    });

    it('should throw error on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        getTeamsWithMembersForEvent(mockSupabase as any, 'event-123')
      ).rejects.toThrow('Failed to fetch teams with members');
    });
  });

  describe('updateTeamSeed', () => {
    it('should update team seed', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await updateTeamSeed(mockSupabase as any, 'team-1', 5);

      expect(mockQuery.update).toHaveBeenCalledWith({ seed: 5 });
      expect(mockQuery.eq).toHaveBeenCalledWith('id', 'team-1');
    });

    it('should throw error on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: { message: 'Update failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(updateTeamSeed(mockSupabase as any, 'team-1', 5)).rejects.toThrow(
        'Failed to update team seed'
      );
    });
  });

  describe('getFullTeamsForEvent', () => {
    it('should return full team details with nested members', async () => {
      const mockTeams = [
        {
          id: 'team-1',
          seed: 1,
          team_members: [
            {
              event_player: {
                id: 'ep-1',
                player: { id: 'p1', full_name: 'Player One' },
              },
            },
          ],
        },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: mockTeams, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getFullTeamsForEvent(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockTeams);
      expect(mockQuery.order).toHaveBeenCalledWith('seed');
    });

    it('should throw error on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(getFullTeamsForEvent(mockSupabase as any, 'event-123')).rejects.toThrow(
        'Failed to fetch generated teams'
      );
    });
  });

  describe('insertTeamsBulk', () => {
    it('should return empty array for empty input', async () => {
      const result = await insertTeamsBulk(mockSupabase as any, []);

      expect(result).toEqual([]);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should insert multiple teams and return IDs', async () => {
      const mockInserted = [{ id: 'team-1' }, { id: 'team-2' }];
      const mockQuery = createMockQueryBuilder();
      mockQuery.insert.mockReturnThis();
      mockQuery.select.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: mockInserted, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await insertTeamsBulk(mockSupabase as any, [
        { eventId: 'event-1', seed: 1, poolCombo: 'A & B' },
        { eventId: 'event-1', seed: 2, poolCombo: 'C & D' },
      ]);

      expect(result).toEqual(['team-1', 'team-2']);
      expect(mockQuery.insert).toHaveBeenCalledWith([
        { event_id: 'event-1', seed: 1, pool_combo: 'A & B' },
        { event_id: 'event-1', seed: 2, pool_combo: 'C & D' },
      ]);
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.insert.mockReturnThis();
      mockQuery.select.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: null, error: { message: 'Insert failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        insertTeamsBulk(mockSupabase as any, [{ eventId: 'e1', seed: 1, poolCombo: 'A' }])
      ).rejects.toThrow(InternalError);
    });
  });

  describe('insertTeamMembersBulk', () => {
    it('should do nothing for empty input', async () => {
      await insertTeamMembersBulk(mockSupabase as any, []);

      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should insert multiple team members', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.insert.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await insertTeamMembersBulk(mockSupabase as any, [
        { teamId: 'team-1', eventPlayerId: 'ep-1', role: 'A_pool' as const },
        { teamId: 'team-1', eventPlayerId: 'ep-2', role: 'B_pool' as const },
      ]);

      expect(mockQuery.insert).toHaveBeenCalledWith([
        { team_id: 'team-1', event_player_id: 'ep-1', role: 'A_pool' },
        { team_id: 'team-1', event_player_id: 'ep-2', role: 'B_pool' },
      ]);
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.insert.mockResolvedValue({ error: { message: 'Insert failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        insertTeamMembersBulk(mockSupabase as any, [
          { teamId: 'team-1', eventPlayerId: 'ep-1', role: 'A_pool' as const },
        ])
      ).rejects.toThrow(InternalError);
    });
  });
});
