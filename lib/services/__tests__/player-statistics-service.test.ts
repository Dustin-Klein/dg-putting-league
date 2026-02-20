
import { createMockSupabaseClient, MockSupabaseClient } from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/repositories/player-statistics-repository', () => ({
  getPlayerByNumber: jest.fn(),
  getPlayerEventParticipations: jest.fn(),
  getTeamInfoForEventPlayers: jest.fn(),
  getPlayerFrameResultsWithDetails: jest.fn(),
  getPlacementsForEvents: jest.fn(),
  getMatchRecordsForTeams: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import * as playerStatsRepo from '@/lib/repositories/player-statistics-repository';
import { getPlayerProfile } from '../player-statistics/player-statistics-service';

describe('Player Statistics Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
  });

  describe('getPlayerProfile', () => {
    it('should correctly calculate placement statistics without overcounting', async () => {
      const playerNumber = 123;
      const playerId = 'player-uuid';

      // Mock player
      (playerStatsRepo.getPlayerByNumber as jest.Mock).mockResolvedValue({
        id: playerId,
        player_number: playerNumber,
        full_name: 'Test Player',
      });

      // Mock participations: 2 events
      (playerStatsRepo.getPlayerEventParticipations as jest.Mock).mockResolvedValue([
        { eventPlayerId: 'ep1', eventId: 'e1', eventDate: '2024-01-01', leagueId: 'l1', leagueName: 'L1', eventStatus: 'completed' },
        { eventPlayerId: 'ep2', eventId: 'e2', eventDate: '2024-01-08', leagueId: 'l1', leagueName: 'L1', eventStatus: 'completed' },
      ]);

      // Mock team info: Same team ID for both events
      const teamInfoMap = new Map();
      teamInfoMap.set('ep1', { teamId: 't1', eventPlayerId: 'ep1' });
      teamInfoMap.set('ep2', { teamId: 't1', eventPlayerId: 'ep2' });
      (playerStatsRepo.getTeamInfoForEventPlayers as jest.Mock).mockResolvedValue(teamInfoMap);

      // Mock frame results: Empty for this test
      (playerStatsRepo.getPlayerFrameResultsWithDetails as jest.Mock).mockResolvedValue([]);

      // Mock placements: 1st in e1, 2nd in e2
      (playerStatsRepo.getPlacementsForEvents as jest.Mock).mockResolvedValue([
        { eventId: 'e1', teamId: 't1', placement: 1 },
        { eventId: 'e2', teamId: 't1', placement: 2 },
      ]);

      // Mock match records: Empty for this test
      (playerStatsRepo.getMatchRecordsForTeams as jest.Mock).mockResolvedValue(new Map());

      const profile = await getPlayerProfile(playerNumber);

      // Should have 1 first place and 2 top three finishes
      // If the bug was present, it would be 2 first place and 4 top three
      expect(profile.statistics.firstPlaceFinishes).toBe(1);
      expect(profile.statistics.topThreeFinishes).toBe(2);
      expect(profile.statistics.eventsPlayed).toBe(2);
    });

    it('should return empty statistics if player has no participations', async () => {
      (playerStatsRepo.getPlayerByNumber as jest.Mock).mockResolvedValue({
        id: 'p1',
        player_number: 1,
        full_name: 'No Play',
      });
      (playerStatsRepo.getPlayerEventParticipations as jest.Mock).mockResolvedValue([]);

      const profile = await getPlayerProfile(1);

      expect(profile.statistics.eventsPlayed).toBe(0);
      expect(profile.statistics.firstPlaceFinishes).toBe(0);
      expect(profile.statistics.topThreeFinishes).toBe(0);
      expect(profile.eventHistory).toEqual([]);
    });

    it('should not expose player email in public profile response', async () => {
      (playerStatsRepo.getPlayerByNumber as jest.Mock).mockResolvedValue({
        id: 'p1',
        player_number: 1,
        full_name: 'No Play',
        email: 'private@example.com',
      });
      (playerStatsRepo.getPlayerEventParticipations as jest.Mock).mockResolvedValue([]);

      const profile = await getPlayerProfile(1);

      expect(profile.player.email).toBeUndefined();
    });
  });
});
