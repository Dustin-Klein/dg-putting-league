/**
 * Team Service Tests
 *
 * Tests for team management functions:
 * - generateTeams()
 * - getEventTeams()
 * - computeTeamPairings()
 */

import { BadRequestError } from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockEventWithDetails,
  createMockEventPlayers,
  createMockTeam,
  MockSupabaseClient,
} from './test-utils';
import type { PoolAssignment } from '../event-player/event-player-service';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/services/auth', () => ({
  requireAuthenticatedUser: jest.fn(),
}));

jest.mock('@/lib/services/event', () => ({
  requireEventAdmin: jest.fn(),
  getEventWithPlayers: jest.fn(),
}));

jest.mock('@/lib/repositories/team-repository', () => ({
  getTeamsForEvent: jest.fn(),
  insertTeam: jest.fn(),
  insertTeamMember: jest.fn(),
  getTeamsWithMembersForEvent: jest.fn(),
  updateTeamSeed: jest.fn(),
  getFullTeamsForEvent: jest.fn(),
}));

jest.mock('@/lib/repositories/event-player-repository', () => ({
  getQualificationScore: jest.fn(),
}));

jest.mock('@/lib/repositories/event-repository', () => ({
  getEventLeagueId: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { requireEventAdmin, getEventWithPlayers } from '@/lib/services/event';
import * as teamRepo from '@/lib/repositories/team-repository';
import * as eventPlayerRepo from '@/lib/repositories/event-player-repository';
import { generateTeams, getEventTeams, computeTeamPairings } from '../team/team-service';

describe('Team Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireEventAdmin as jest.Mock).mockResolvedValue({ supabase: mockSupabase });
  });

  describe('generateTeams', () => {
    const eventId = 'event-123';

    it('should generate teams for event in pre-bracket status', async () => {
      const players = createMockEventPlayers(4, eventId);
      players[0].pool = 'A';
      players[1].pool = 'A';
      players[2].pool = 'B';
      players[3].pool = 'B';

      const event = createMockEventWithDetails(
        { id: eventId, status: 'pre-bracket', qualification_round_enabled: false },
        players
      );

      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);
      (teamRepo.getTeamsForEvent as jest.Mock).mockResolvedValue([]);
      (eventPlayerRepo.getQualificationScore as jest.Mock).mockResolvedValue(0);
      (teamRepo.insertTeam as jest.Mock)
        .mockResolvedValueOnce('team-1')
        .mockResolvedValueOnce('team-2');
      (teamRepo.insertTeamMember as jest.Mock).mockResolvedValue(undefined);
      (teamRepo.getTeamsWithMembersForEvent as jest.Mock).mockResolvedValue([
        {
          id: 'team-1',
          seed: 1,
          team_members: [
            { event_player_id: players[0].id },
            { event_player_id: players[2].id },
          ],
        },
        {
          id: 'team-2',
          seed: 2,
          team_members: [
            { event_player_id: players[1].id },
            { event_player_id: players[3].id },
          ],
        },
      ]);
      (teamRepo.updateTeamSeed as jest.Mock).mockResolvedValue(undefined);
      (teamRepo.getFullTeamsForEvent as jest.Mock).mockResolvedValue([
        createMockTeam({ id: 'team-1', seed: 1 }),
        createMockTeam({ id: 'team-2', seed: 2 }),
      ]);

      const result = await generateTeams(eventId);

      expect(result).toHaveLength(2);
      expect(teamRepo.insertTeam).toHaveBeenCalledTimes(2);
      expect(teamRepo.insertTeamMember).toHaveBeenCalledTimes(4); // 2 members per team
    });

    it('should generate teams for event in bracket status', async () => {
      const players = createMockEventPlayers(2, eventId);
      players[0].pool = 'A';
      players[1].pool = 'B';

      const event = createMockEventWithDetails(
        { id: eventId, status: 'bracket' },
        players
      );

      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);
      (teamRepo.getTeamsForEvent as jest.Mock).mockResolvedValue([]);
      (eventPlayerRepo.getQualificationScore as jest.Mock).mockResolvedValue(0);
      (teamRepo.insertTeam as jest.Mock).mockResolvedValue('team-1');
      (teamRepo.insertTeamMember as jest.Mock).mockResolvedValue(undefined);
      (teamRepo.getTeamsWithMembersForEvent as jest.Mock).mockResolvedValue([
        {
          id: 'team-1',
          seed: 1,
          team_members: [
            { event_player_id: players[0].id },
            { event_player_id: players[1].id },
          ],
        },
      ]);
      (teamRepo.updateTeamSeed as jest.Mock).mockResolvedValue(undefined);
      (teamRepo.getFullTeamsForEvent as jest.Mock).mockResolvedValue([
        createMockTeam({ id: 'team-1', seed: 1 }),
      ]);

      const result = await generateTeams(eventId);

      expect(result).toHaveLength(1);
    });

    it('should throw BadRequestError for invalid event status', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'created' });
      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);

      await expect(generateTeams(eventId)).rejects.toThrow(BadRequestError);
      await expect(generateTeams(eventId)).rejects.toThrow(
        'Teams can only be generated for events in pre-bracket or bracket status'
      );
    });

    it('should throw BadRequestError when teams already exist', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' });
      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);
      (teamRepo.getTeamsForEvent as jest.Mock).mockResolvedValue([createMockTeam()]);

      await expect(generateTeams(eventId)).rejects.toThrow(BadRequestError);
      await expect(generateTeams(eventId)).rejects.toThrow(
        'Teams have already been generated for this event'
      );
    });

    it('should throw BadRequestError when no players have pools assigned', async () => {
      const players = createMockEventPlayers(4, eventId);
      // No pool assignments
      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' }, players);

      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);
      (teamRepo.getTeamsForEvent as jest.Mock).mockResolvedValue([]);

      await expect(generateTeams(eventId)).rejects.toThrow(BadRequestError);
      await expect(generateTeams(eventId)).rejects.toThrow(
        'No players have been assigned to pools'
      );
    });

    it('should throw BadRequestError when Pool A is empty', async () => {
      const players = createMockEventPlayers(2, eventId);
      players[0].pool = 'B';
      players[1].pool = 'B';

      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' }, players);

      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);
      (teamRepo.getTeamsForEvent as jest.Mock).mockResolvedValue([]);

      await expect(generateTeams(eventId)).rejects.toThrow(BadRequestError);
      await expect(generateTeams(eventId)).rejects.toThrow(
        'Both Pool A and Pool B must have players'
      );
    });

    it('should throw BadRequestError when Pool B is empty', async () => {
      const players = createMockEventPlayers(2, eventId);
      players[0].pool = 'A';
      players[1].pool = 'A';

      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' }, players);

      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);
      (teamRepo.getTeamsForEvent as jest.Mock).mockResolvedValue([]);

      await expect(generateTeams(eventId)).rejects.toThrow(BadRequestError);
      await expect(generateTeams(eventId)).rejects.toThrow(
        'Both Pool A and Pool B must have players'
      );
    });

    it('should use qualification scores for seeding when enabled', async () => {
      const players = createMockEventPlayers(4, eventId);
      players[0].pool = 'A';
      players[1].pool = 'A';
      players[2].pool = 'B';
      players[3].pool = 'B';

      const event = createMockEventWithDetails(
        { id: eventId, status: 'pre-bracket', qualification_round_enabled: true },
        players
      );

      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);
      (teamRepo.getTeamsForEvent as jest.Mock).mockResolvedValue([]);
      (eventPlayerRepo.getQualificationScore as jest.Mock)
        .mockResolvedValueOnce(30) // Player 1
        .mockResolvedValueOnce(20) // Player 2
        .mockResolvedValueOnce(25) // Player 3
        .mockResolvedValueOnce(15); // Player 4
      (teamRepo.insertTeam as jest.Mock).mockResolvedValue('team-1');
      (teamRepo.insertTeamMember as jest.Mock).mockResolvedValue(undefined);
      (teamRepo.getTeamsWithMembersForEvent as jest.Mock).mockResolvedValue([
        {
          id: 'team-1',
          seed: 1,
          team_members: [
            { event_player_id: players[0].id },
            { event_player_id: players[2].id },
          ],
        },
      ]);
      (teamRepo.updateTeamSeed as jest.Mock).mockResolvedValue(undefined);
      (teamRepo.getFullTeamsForEvent as jest.Mock).mockResolvedValue([
        createMockTeam({ id: 'team-1', seed: 1 }),
      ]);

      await generateTeams(eventId);

      expect(eventPlayerRepo.getQualificationScore).toHaveBeenCalledTimes(4);
    });
  });

  describe('getEventTeams', () => {
    const eventId = 'event-123';

    it('should return teams for an event', async () => {
      const mockTeams = [
        createMockTeam({ id: 'team-1', seed: 1 }),
        createMockTeam({ id: 'team-2', seed: 2 }),
      ];
      (teamRepo.getFullTeamsForEvent as jest.Mock).mockResolvedValue(mockTeams);

      const result = await getEventTeams(eventId);

      expect(result).toEqual(mockTeams);
      expect(teamRepo.getFullTeamsForEvent).toHaveBeenCalledWith(mockSupabase, eventId);
    });

    it('should return empty array when no teams exist', async () => {
      (teamRepo.getFullTeamsForEvent as jest.Mock).mockResolvedValue([]);

      const result = await getEventTeams(eventId);

      expect(result).toEqual([]);
    });

    it('should require event admin permission', async () => {
      (requireEventAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      await expect(getEventTeams(eventId)).rejects.toThrow('Not authorized');
    });
  });

  describe('computeTeamPairings', () => {
    it('should pair Pool A and Pool B players into teams', () => {
      const poolAssignments: PoolAssignment[] = [
        {
          eventPlayerId: 'ep-1',
          playerId: 'p-1',
          playerName: 'Player One',
          pool: 'A',
          pfaScore: 30,
          scoringMethod: 'qualification',
          defaultPool: 'A',
        },
        {
          eventPlayerId: 'ep-2',
          playerId: 'p-2',
          playerName: 'Player Two',
          pool: 'A',
          pfaScore: 20,
          scoringMethod: 'qualification',
          defaultPool: 'A',
        },
        {
          eventPlayerId: 'ep-3',
          playerId: 'p-3',
          playerName: 'Player Three',
          pool: 'B',
          pfaScore: 25,
          scoringMethod: 'qualification',
          defaultPool: 'B',
        },
        {
          eventPlayerId: 'ep-4',
          playerId: 'p-4',
          playerName: 'Player Four',
          pool: 'B',
          pfaScore: 15,
          scoringMethod: 'qualification',
          defaultPool: 'B',
        },
      ];

      const result = computeTeamPairings(poolAssignments);

      expect(result).toHaveLength(2);
      // Teams should be sorted by combined score (descending)
      expect(result[0].seed).toBe(1);
      expect(result[1].seed).toBe(2);
      // Each team should have one A_pool and one B_pool member
      result.forEach((team) => {
        expect(team.members).toHaveLength(2);
        expect(team.members.some((m) => m.role === 'A_pool')).toBe(true);
        expect(team.members.some((m) => m.role === 'B_pool')).toBe(true);
      });
    });

    it('should throw BadRequestError when Pool A is empty', () => {
      const poolAssignments: PoolAssignment[] = [
        {
          eventPlayerId: 'ep-1',
          playerId: 'p-1',
          playerName: 'Player One',
          pool: 'B',
          pfaScore: 30,
          scoringMethod: 'default',
          defaultPool: 'B',
        },
      ];

      expect(() => computeTeamPairings(poolAssignments)).toThrow(BadRequestError);
      expect(() => computeTeamPairings(poolAssignments)).toThrow(
        'Both Pool A and Pool B must have players'
      );
    });

    it('should throw BadRequestError when Pool B is empty', () => {
      const poolAssignments: PoolAssignment[] = [
        {
          eventPlayerId: 'ep-1',
          playerId: 'p-1',
          playerName: 'Player One',
          pool: 'A',
          pfaScore: 30,
          scoringMethod: 'default',
          defaultPool: 'A',
        },
      ];

      expect(() => computeTeamPairings(poolAssignments)).toThrow(BadRequestError);
    });

    it('should handle uneven pool sizes by using minimum', () => {
      const poolAssignments: PoolAssignment[] = [
        {
          eventPlayerId: 'ep-1',
          playerId: 'p-1',
          playerName: 'Player One',
          pool: 'A',
          pfaScore: 30,
          scoringMethod: 'default',
          defaultPool: 'A',
        },
        {
          eventPlayerId: 'ep-2',
          playerId: 'p-2',
          playerName: 'Player Two',
          pool: 'A',
          pfaScore: 20,
          scoringMethod: 'default',
          defaultPool: 'A',
        },
        {
          eventPlayerId: 'ep-3',
          playerId: 'p-3',
          playerName: 'Player Three',
          pool: 'A',
          pfaScore: 10,
          scoringMethod: 'default',
          defaultPool: 'A',
        },
        {
          eventPlayerId: 'ep-4',
          playerId: 'p-4',
          playerName: 'Player Four',
          pool: 'B',
          pfaScore: 25,
          scoringMethod: 'default',
          defaultPool: 'B',
        },
      ];

      const result = computeTeamPairings(poolAssignments);

      // Should only create 1 team (min of 3 Pool A, 1 Pool B)
      expect(result).toHaveLength(1);
    });

    it('should calculate combined score correctly', () => {
      const poolAssignments: PoolAssignment[] = [
        {
          eventPlayerId: 'ep-1',
          playerId: 'p-1',
          playerName: 'Player One',
          pool: 'A',
          pfaScore: 30,
          scoringMethod: 'default',
          defaultPool: 'A',
        },
        {
          eventPlayerId: 'ep-2',
          playerId: 'p-2',
          playerName: 'Player Two',
          pool: 'B',
          pfaScore: 25,
          scoringMethod: 'default',
          defaultPool: 'B',
        },
      ];

      const result = computeTeamPairings(poolAssignments);

      expect(result[0].combinedScore).toBe(55); // 30 + 25
    });

    it('should generate pool combo names', () => {
      const poolAssignments: PoolAssignment[] = [
        {
          eventPlayerId: 'ep-1',
          playerId: 'p-1',
          playerName: 'Alice',
          pool: 'A',
          pfaScore: 30,
          scoringMethod: 'default',
          defaultPool: 'A',
        },
        {
          eventPlayerId: 'ep-2',
          playerId: 'p-2',
          playerName: 'Bob',
          pool: 'B',
          pfaScore: 25,
          scoringMethod: 'default',
          defaultPool: 'B',
        },
      ];

      const result = computeTeamPairings(poolAssignments);

      expect(result[0].poolCombo).toContain('Alice');
      expect(result[0].poolCombo).toContain('Bob');
      expect(result[0].poolCombo).toContain('&');
    });

    it('should assign sequential seeds based on score ranking', () => {
      const poolAssignments: PoolAssignment[] = [
        {
          eventPlayerId: 'ep-1',
          playerId: 'p-1',
          playerName: 'P1',
          pool: 'A',
          pfaScore: 10,
          scoringMethod: 'default',
          defaultPool: 'A',
        },
        {
          eventPlayerId: 'ep-2',
          playerId: 'p-2',
          playerName: 'P2',
          pool: 'A',
          pfaScore: 30,
          scoringMethod: 'default',
          defaultPool: 'A',
        },
        {
          eventPlayerId: 'ep-3',
          playerId: 'p-3',
          playerName: 'P3',
          pool: 'B',
          pfaScore: 5,
          scoringMethod: 'default',
          defaultPool: 'B',
        },
        {
          eventPlayerId: 'ep-4',
          playerId: 'p-4',
          playerName: 'P4',
          pool: 'B',
          pfaScore: 25,
          scoringMethod: 'default',
          defaultPool: 'B',
        },
      ];

      const result = computeTeamPairings(poolAssignments);

      expect(result[0].seed).toBe(1);
      expect(result[1].seed).toBe(2);
      // Higher combined score should be seed 1
      expect(result[0].combinedScore).toBeGreaterThanOrEqual(result[1].combinedScore);
    });
  });
});
