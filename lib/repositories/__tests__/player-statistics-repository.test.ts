/**
 * Player Statistics Repository Tests
 *
 * Tests for player statistics data access including:
 * - Player lookup and event participation queries
 * - Team info aggregation
 * - Bracket match result lookups
 * - Frame result queries
 * - Placement calculations
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  createMockSupabaseClient,
  createMockQueryBuilder,
  MockSupabaseClient,
} from '@/lib/services/__tests__/test-utils';
import { InternalError } from '@/lib/errors';

// Mock server-only before importing repository
jest.mock('server-only', () => ({}));

// Mock the event-placement-repository dependency
jest.mock('../event-placement-repository', () => ({
  getStoredPlacementsForEvents: jest.fn(),
}));

import {
  getPlayerByNumber,
  getPlayerEventParticipations,
  getTeamInfoForEventPlayers,
  getBracketMatchResultsForTeams,
  getMatchRecordsForTeams,
  getPlayerFrameResultsWithDetails,
  getPlacementsForEvents,
  calculateEventPlacements,
} from '../player-statistics-repository';
import * as eventPlacementRepo from '../event-placement-repository';

describe('Player Statistics Repository', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
  });

  describe('getPlayerByNumber', () => {
    it('should return player when found', async () => {
      const mockPlayer = {
        id: 'player-123',
        full_name: 'John Doe',
        player_number: 42,
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockPlayer, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPlayerByNumber(mockSupabase as any, 42);

      expect(result).toEqual(mockPlayer);
      expect(mockSupabase.from).toHaveBeenCalledWith('players');
      expect(mockQuery.eq).toHaveBeenCalledWith('player_number', 42);
    });

    it('should return null when player not found', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPlayerByNumber(mockSupabase as any, 999);

      expect(result).toBeNull();
    });

    it('should throw InternalError on query failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(getPlayerByNumber(mockSupabase as any, 42)).rejects.toThrow(InternalError);
    });
  });

  describe('getPlayerEventParticipations', () => {
    it('should return event participations with mapped data', async () => {
      const mockData = [
        {
          id: 'ep-1',
          event_id: 'event-1',
          pool: 'A',
          event: {
            id: 'event-1',
            event_date: '2024-06-15',
            league_id: 'league-1',
            location: 'Test Location',
            status: 'completed',
            league: { id: 'league-1', name: 'Test League' },
          },
        },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: mockData, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPlayerEventParticipations(mockSupabase as any, 'player-123');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        eventPlayerId: 'ep-1',
        eventId: 'event-1',
        eventDate: '2024-06-15',
        pool: 'A',
        leagueId: 'league-1',
        leagueName: 'Test League',
        location: 'Test Location',
        eventStatus: 'completed',
      });
    });

    it('should filter out entries with null event', async () => {
      const mockData = [
        { id: 'ep-1', event_id: 'event-1', pool: 'A', event: null },
        {
          id: 'ep-2',
          event_id: 'event-2',
          pool: 'B',
          event: {
            id: 'event-2',
            event_date: '2024-06-20',
            league_id: 'league-1',
            location: null,
            status: 'created',
            league: null,
          },
        },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: mockData, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPlayerEventParticipations(mockSupabase as any, 'player-123');

      expect(result).toHaveLength(1);
      expect(result[0].eventPlayerId).toBe('ep-2');
      expect(result[0].leagueName).toBe('Unknown League');
    });

    it('should return empty array when no data', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPlayerEventParticipations(mockSupabase as any, 'player-123');

      expect(result).toEqual([]);
    });

    it('should throw InternalError on query failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        getPlayerEventParticipations(mockSupabase as any, 'player-123')
      ).rejects.toThrow(InternalError);
    });
  });

  describe('getTeamInfoForEventPlayers', () => {
    it('should return empty map for empty input', async () => {
      const result = await getTeamInfoForEventPlayers(mockSupabase as any, []);

      expect(result.size).toBe(0);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should return team info mapped by event player id', async () => {
      const mockData = [
        {
          event_player_id: 'ep-1',
          team_id: 'team-1',
          team: {
            id: 'team-1',
            seed: 1,
            team_members: [
              {
                event_player_id: 'ep-1',
                event_player: {
                  id: 'ep-1',
                  player_id: 'p1',
                  player: { id: 'p1', full_name: 'Player One' },
                },
              },
              {
                event_player_id: 'ep-2',
                event_player: {
                  id: 'ep-2',
                  player_id: 'p2',
                  player: { id: 'p2', full_name: 'Player Two' },
                },
              },
            ],
          },
        },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.in.mockResolvedValue({ data: mockData, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getTeamInfoForEventPlayers(mockSupabase as any, ['ep-1']);

      expect(result.size).toBe(1);
      const teamInfo = result.get('ep-1');
      expect(teamInfo).toEqual({
        eventPlayerId: 'ep-1',
        teamId: 'team-1',
        seed: 1,
        teammateEventPlayerId: 'ep-2',
        teammatePlayerId: 'p2',
        teammateName: 'Player Two',
      });
    });

    it('should handle null team gracefully', async () => {
      const mockData = [
        { event_player_id: 'ep-1', team_id: 'team-1', team: null },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.in.mockResolvedValue({ data: mockData, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getTeamInfoForEventPlayers(mockSupabase as any, ['ep-1']);

      expect(result.size).toBe(0);
    });

    it('should throw InternalError on query failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.in.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        getTeamInfoForEventPlayers(mockSupabase as any, ['ep-1'])
      ).rejects.toThrow(InternalError);
    });
  });

  describe('getBracketMatchResultsForTeams', () => {
    it('should return empty array for empty inputs', async () => {
      const result1 = await getBracketMatchResultsForTeams(mockSupabase as any, [], ['event-1']);
      const result2 = await getBracketMatchResultsForTeams(mockSupabase as any, ['team-1'], []);

      expect(result1).toEqual([]);
      expect(result2).toEqual([]);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should return bracket match results for teams', async () => {
      const mockParticipants = [
        { id: 1, team_id: 'team-1', tournament_id: 'event-1' },
        { id: 2, team_id: 'team-2', tournament_id: 'event-1' },
      ];
      const mockMatches = [
        {
          id: 101,
          event_id: 'event-1',
          opponent1: { id: 1, result: 'win' },
          opponent2: { id: 2, result: 'loss' },
        },
      ];

      const participantsQuery = createMockQueryBuilder();
      participantsQuery.select.mockReturnThis();
      // Chain .in().in() - first returns this, second resolves
      let participantsInCount = 0;
      participantsQuery.in.mockImplementation(() => {
        participantsInCount++;
        if (participantsInCount === 2) {
          return Promise.resolve({ data: mockParticipants, error: null });
        }
        return participantsQuery;
      });

      const matchesQuery = createMockQueryBuilder();
      matchesQuery.select.mockReturnThis();
      // Chain .in().in()
      let matchesInCount = 0;
      matchesQuery.in.mockImplementation(() => {
        matchesInCount++;
        if (matchesInCount === 2) {
          return Promise.resolve({ data: mockMatches, error: null });
        }
        return matchesQuery;
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'bracket_participant') return participantsQuery;
        if (table === 'bracket_match') return matchesQuery;
        return createMockQueryBuilder();
      });

      const result = await getBracketMatchResultsForTeams(
        mockSupabase as any,
        ['team-1', 'team-2'],
        ['event-1']
      );

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        teamId: 'team-1',
        eventId: 'event-1',
        bracketMatchId: 101,
        result: 'win',
      });
      expect(result).toContainEqual({
        teamId: 'team-2',
        eventId: 'event-1',
        bracketMatchId: 101,
        result: 'loss',
      });
    });

    it('should return empty array when no participants found', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      // Chain .in().in()
      let inCount = 0;
      mockQuery.in.mockImplementation(() => {
        inCount++;
        if (inCount === 2) {
          return Promise.resolve({ data: [], error: null });
        }
        return mockQuery;
      });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getBracketMatchResultsForTeams(
        mockSupabase as any,
        ['team-1'],
        ['event-1']
      );

      expect(result).toEqual([]);
    });
  });

  describe('getMatchRecordsForTeams', () => {
    it('should aggregate wins and losses per event:team', async () => {
      const mockParticipants = [
        { id: 1, team_id: 'team-1', tournament_id: 'event-1' },
        { id: 2, team_id: 'team-2', tournament_id: 'event-1' },
      ];
      const mockMatches = [
        {
          id: 101,
          event_id: 'event-1',
          opponent1: { id: 1, result: 'win' },
          opponent2: { id: 2, result: 'loss' },
        },
        {
          id: 102,
          event_id: 'event-1',
          opponent1: { id: 1, result: 'win' },
          opponent2: { id: 2, result: 'loss' },
        },
      ];

      const participantsQuery = createMockQueryBuilder();
      participantsQuery.select.mockReturnThis();
      // Chain .in().in()
      let participantsInCount = 0;
      participantsQuery.in.mockImplementation(() => {
        participantsInCount++;
        if (participantsInCount === 2) {
          return Promise.resolve({ data: mockParticipants, error: null });
        }
        return participantsQuery;
      });

      const matchesQuery = createMockQueryBuilder();
      matchesQuery.select.mockReturnThis();
      // Chain .in().in()
      let matchesInCount = 0;
      matchesQuery.in.mockImplementation(() => {
        matchesInCount++;
        if (matchesInCount === 2) {
          return Promise.resolve({ data: mockMatches, error: null });
        }
        return matchesQuery;
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'bracket_participant') return participantsQuery;
        if (table === 'bracket_match') return matchesQuery;
        return createMockQueryBuilder();
      });

      const result = await getMatchRecordsForTeams(
        mockSupabase as any,
        ['team-1', 'team-2'],
        ['event-1']
      );

      expect(result.get('event-1:team-1')).toEqual({ wins: 2, losses: 0 });
      expect(result.get('event-1:team-2')).toEqual({ wins: 0, losses: 2 });
    });
  });

  describe('getPlayerFrameResultsWithDetails', () => {
    it('should return empty array for empty input', async () => {
      const result = await getPlayerFrameResultsWithDetails(mockSupabase as any, []);

      expect(result).toEqual([]);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should return frame results mapped correctly', async () => {
      const mockData = [
        {
          id: 'fr-1',
          event_player_id: 'ep-1',
          bracket_match_id: 101,
          putts_made: 3,
          points_earned: 3,
          match_frame: { id: 'mf-1', frame_number: 1 },
        },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.in.mockResolvedValue({ data: mockData, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPlayerFrameResultsWithDetails(mockSupabase as any, ['ep-1']);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        eventPlayerId: 'ep-1',
        bracketMatchId: 101,
        frameId: 'mf-1',
        frameNumber: 1,
        puttsMade: 3,
        pointsEarned: 3,
      });
    });

    it('should filter out entries with null bracket_match_id or match_frame', async () => {
      const mockData = [
        {
          id: 'fr-1',
          event_player_id: 'ep-1',
          bracket_match_id: null,
          putts_made: 3,
          points_earned: 3,
          match_frame: { id: 'mf-1', frame_number: 1 },
        },
        {
          id: 'fr-2',
          event_player_id: 'ep-1',
          bracket_match_id: 101,
          putts_made: 2,
          points_earned: 2,
          match_frame: null,
        },
        {
          id: 'fr-3',
          event_player_id: 'ep-1',
          bracket_match_id: 102,
          putts_made: 4,
          points_earned: 4,
          match_frame: { id: 'mf-3', frame_number: 3 },
        },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.in.mockResolvedValue({ data: mockData, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getPlayerFrameResultsWithDetails(mockSupabase as any, ['ep-1']);

      expect(result).toHaveLength(1);
      expect(result[0].bracketMatchId).toBe(102);
    });
  });

  describe('getPlacementsForEvents', () => {
    it('should return empty array for empty input', async () => {
      const result = await getPlacementsForEvents(mockSupabase as any, []);

      expect(result).toEqual([]);
    });

    it('should combine stored and calculated placements', async () => {
      const storedPlacements = [
        { eventId: 'event-1', teamId: 'team-1', placement: 1 },
        { eventId: 'event-1', teamId: 'team-2', placement: 2 },
      ];
      (eventPlacementRepo.getStoredPlacementsForEvents as jest.Mock).mockResolvedValue(
        storedPlacements
      );

      // For event-2, we need to calculate
      const stageQuery = createMockQueryBuilder();
      stageQuery.select.mockReturnThis();
      stageQuery.eq.mockReturnThis();
      stageQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(stageQuery);

      const result = await getPlacementsForEvents(mockSupabase as any, ['event-1', 'event-2']);

      // Should include stored placements from event-1
      expect(result).toContainEqual({ eventId: 'event-1', teamId: 'team-1', placement: 1 });
      expect(result).toContainEqual({ eventId: 'event-1', teamId: 'team-2', placement: 2 });
    });
  });

  describe('calculateEventPlacements', () => {
    it('should return empty array when no stage exists', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await calculateEventPlacements(mockSupabase as any, 'event-123');

      expect(result).toEqual([]);
    });

    it('should return empty array when no groups exist', async () => {
      const stageQuery = createMockQueryBuilder();
      stageQuery.select.mockReturnThis();
      stageQuery.eq.mockReturnThis();
      stageQuery.maybeSingle.mockResolvedValue({ data: { id: 1 }, error: null });

      const groupsQuery = createMockQueryBuilder();
      groupsQuery.select.mockReturnThis();
      groupsQuery.eq.mockResolvedValue({ data: null, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'bracket_stage') return stageQuery;
        if (table === 'bracket_group') return groupsQuery;
        return createMockQueryBuilder();
      });

      const result = await calculateEventPlacements(mockSupabase as any, 'event-123');

      expect(result).toEqual([]);
    });

    it('should calculate placements from bracket structure', async () => {
      const mockStage = { id: 1 };
      const mockGroups = [
        { id: 1, number: 1 }, // Winners bracket
        { id: 2, number: 2 }, // Losers bracket
        { id: 3, number: 3 }, // Grand final
      ];
      const mockRounds = [
        { id: 10, number: 1, group_id: 3 }, // GF round 1
        { id: 11, number: 2, group_id: 3 }, // GF round 2 (reset)
      ];
      const mockMatches = [
        {
          id: 101,
          round_id: 11,
          status: 4, // Completed
          opponent1: { id: 1, result: 'win' },
          opponent2: { id: 2, result: 'loss' },
        },
      ];
      const mockParticipants = [
        { id: 1, team_id: 'team-1' },
        { id: 2, team_id: 'team-2' },
      ];

      const stageQuery = createMockQueryBuilder();
      stageQuery.select.mockReturnThis();
      stageQuery.eq.mockReturnThis();
      stageQuery.maybeSingle.mockResolvedValue({ data: mockStage, error: null });

      const groupsQuery = createMockQueryBuilder();
      groupsQuery.select.mockReturnThis();
      groupsQuery.eq.mockResolvedValue({ data: mockGroups, error: null });

      const roundsQuery = createMockQueryBuilder();
      roundsQuery.select.mockReturnThis();
      roundsQuery.in.mockResolvedValue({ data: mockRounds, error: null });

      const matchesQuery = createMockQueryBuilder();
      matchesQuery.select.mockReturnThis();
      matchesQuery.eq.mockReturnThis();
      matchesQuery.in.mockResolvedValue({ data: mockMatches, error: null });

      const participantsQuery = createMockQueryBuilder();
      participantsQuery.select.mockReturnThis();
      participantsQuery.eq.mockResolvedValue({ data: mockParticipants, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'bracket_stage') return stageQuery;
        if (table === 'bracket_group') return groupsQuery;
        if (table === 'bracket_round') return roundsQuery;
        if (table === 'bracket_match') return matchesQuery;
        if (table === 'bracket_participant') return participantsQuery;
        return createMockQueryBuilder();
      });

      const result = await calculateEventPlacements(mockSupabase as any, 'event-123');

      expect(result).toContainEqual({
        eventId: 'event-123',
        teamId: 'team-1',
        placement: 1,
      });
      expect(result).toContainEqual({
        eventId: 'event-123',
        teamId: 'team-2',
        placement: 2,
      });
    });

    it('should return empty when no completed matches', async () => {
      const mockStage = { id: 1 };
      const mockGroups = [{ id: 1, number: 1 }];
      const mockRounds = [{ id: 10, number: 1, group_id: 1 }];

      const stageQuery = createMockQueryBuilder();
      stageQuery.select.mockReturnThis();
      stageQuery.eq.mockReturnThis();
      stageQuery.maybeSingle.mockResolvedValue({ data: mockStage, error: null });

      const groupsQuery = createMockQueryBuilder();
      groupsQuery.select.mockReturnThis();
      groupsQuery.eq.mockResolvedValue({ data: mockGroups, error: null });

      const roundsQuery = createMockQueryBuilder();
      roundsQuery.select.mockReturnThis();
      roundsQuery.in.mockResolvedValue({ data: mockRounds, error: null });

      const matchesQuery = createMockQueryBuilder();
      matchesQuery.select.mockReturnThis();
      matchesQuery.eq.mockReturnThis();
      matchesQuery.in.mockResolvedValue({ data: [], error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'bracket_stage') return stageQuery;
        if (table === 'bracket_group') return groupsQuery;
        if (table === 'bracket_round') return roundsQuery;
        if (table === 'bracket_match') return matchesQuery;
        return createMockQueryBuilder();
      });

      const result = await calculateEventPlacements(mockSupabase as any, 'event-123');

      expect(result).toEqual([]);
    });
  });
});
