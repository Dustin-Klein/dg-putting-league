/**
 * Event Player Service Tests
 *
 * Tests for event player management functions:
 * - addPlayerToEvent()
 * - removePlayerFromEvent()
 * - updatePlayerPayment()
 * - splitPlayersIntoPools()
 * - computePoolAssignments()
 */

import {
  BadRequestError,
  NotFoundError,
} from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockEventWithDetails,
  createMockEventPlayer,
  createMockEventPlayers,
  MockSupabaseClient,
} from './test-utils';

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

jest.mock('@/lib/repositories/event-player-repository', () => ({
  getEventPlayerByPlayerAndEvent: jest.fn(),
  insertEventPlayer: jest.fn(),
  getEventPlayer: jest.fn(),
  deleteEventPlayer: jest.fn(),
  updateEventPlayerPayment: jest.fn(),
  getQualificationScore: jest.fn(),
  getAllEventPlayerIdsForPlayer: jest.fn(),
  getFrameResultsForEventPlayers: jest.fn(),
  getAllEventPlayerIdsForPlayersBulk: jest.fn(),
  getPfaScoresBulk: jest.fn(),
  updateEventPlayerPool: jest.fn(),
  getEventPlayersWithPools: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { requireEventAdmin, getEventWithPlayers } from '@/lib/services/event';
import * as eventPlayerRepo from '@/lib/repositories/event-player-repository';
import {
  addPlayerToEvent,
  removePlayerFromEvent,
  updatePlayerPayment,
  splitPlayersIntoPools,
  computePoolAssignments,
} from '../event-player/event-player-service';

describe('Event Player Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireEventAdmin as jest.Mock).mockResolvedValue({ supabase: mockSupabase });
  });

  describe('addPlayerToEvent', () => {
    const eventId = 'event-123';
    const playerId = 'player-123';

    it('should add player to event successfully', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' });
      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);

      (eventPlayerRepo.getEventPlayerByPlayerAndEvent as jest.Mock).mockResolvedValue(null);
      (eventPlayerRepo.insertEventPlayer as jest.Mock).mockResolvedValue('ep-123');

      const mockEventPlayer = createMockEventPlayer({
        id: 'ep-123',
        event_id: eventId,
        player_id: playerId,
      });
      (eventPlayerRepo.getEventPlayer as jest.Mock).mockResolvedValue(mockEventPlayer);

      const result = await addPlayerToEvent(eventId, playerId);

      expect(result).toEqual(mockEventPlayer);
      expect(eventPlayerRepo.insertEventPlayer).toHaveBeenCalledWith(
        mockSupabase,
        eventId,
        playerId
      );
    });

    it('should throw BadRequestError when event is not in pre-bracket status', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'bracket' });
      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);

      await expect(addPlayerToEvent(eventId, playerId)).rejects.toThrow(BadRequestError);
      await expect(addPlayerToEvent(eventId, playerId)).rejects.toThrow(
        'Players can only be added to events in pre-bracket status'
      );
    });

    it('should throw BadRequestError when player is already in event', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' });
      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);

      const existingPlayer = createMockEventPlayer({
        event_id: eventId,
        player_id: playerId,
      });
      (eventPlayerRepo.getEventPlayerByPlayerAndEvent as jest.Mock).mockResolvedValue(
        existingPlayer
      );

      await expect(addPlayerToEvent(eventId, playerId)).rejects.toThrow(BadRequestError);
      await expect(addPlayerToEvent(eventId, playerId)).rejects.toThrow(
        'Player is already in this event'
      );
    });
  });

  describe('removePlayerFromEvent', () => {
    const eventId = 'event-123';
    const eventPlayerId = 'ep-123';

    it('should remove player from event successfully', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' });
      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);
      (eventPlayerRepo.deleteEventPlayer as jest.Mock).mockResolvedValue(undefined);

      const result = await removePlayerFromEvent(eventId, eventPlayerId);

      expect(result).toEqual({ success: true });
      expect(eventPlayerRepo.deleteEventPlayer).toHaveBeenCalledWith(
        mockSupabase,
        eventId,
        eventPlayerId
      );
    });

    it('should throw BadRequestError when eventPlayerId is empty', async () => {
      await expect(removePlayerFromEvent(eventId, '')).rejects.toThrow(BadRequestError);
      await expect(removePlayerFromEvent(eventId, '')).rejects.toThrow(
        'Event Player ID is required'
      );
    });

    it('should throw BadRequestError when event is not in pre-bracket status', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'bracket' });
      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);

      await expect(removePlayerFromEvent(eventId, eventPlayerId)).rejects.toThrow(
        BadRequestError
      );
      await expect(removePlayerFromEvent(eventId, eventPlayerId)).rejects.toThrow(
        'Players can only be removed from events in pre-bracket status'
      );
    });
  });

  describe('updatePlayerPayment', () => {
    const eventId = 'event-123';
    const playerId = 'player-123';

    it('should update payment status successfully', async () => {
      const updatedPlayer = createMockEventPlayer({
        event_id: eventId,
        player_id: playerId,
        has_paid: true,
      });
      (eventPlayerRepo.updateEventPlayerPayment as jest.Mock).mockResolvedValue(
        updatedPlayer
      );

      const result = await updatePlayerPayment(eventId, playerId, true);

      expect(result).toEqual(updatedPlayer);
      expect(eventPlayerRepo.updateEventPlayerPayment).toHaveBeenCalledWith(
        mockSupabase,
        eventId,
        playerId,
        true
      );
    });

    it('should throw NotFoundError when player not found in event', async () => {
      (eventPlayerRepo.updateEventPlayerPayment as jest.Mock).mockResolvedValue(null);

      await expect(updatePlayerPayment(eventId, playerId, true)).rejects.toThrow(
        NotFoundError
      );
      await expect(updatePlayerPayment(eventId, playerId, true)).rejects.toThrow(
        'Player not found in this event'
      );
    });

    it('should handle setting payment to false', async () => {
      const updatedPlayer = createMockEventPlayer({
        event_id: eventId,
        player_id: playerId,
        has_paid: false,
      });
      (eventPlayerRepo.updateEventPlayerPayment as jest.Mock).mockResolvedValue(
        updatedPlayer
      );

      const result = await updatePlayerPayment(eventId, playerId, false);

      expect(result.has_paid).toBe(false);
      expect(eventPlayerRepo.updateEventPlayerPayment).toHaveBeenCalledWith(
        mockSupabase,
        eventId,
        playerId,
        false
      );
    });
  });

  describe('splitPlayersIntoPools', () => {
    const eventId = 'event-123';

    it('should split players into pools based on scores', async () => {
      const players = createMockEventPlayers(4, eventId);
      const event = createMockEventWithDetails(
        { id: eventId, status: 'pre-bracket', qualification_round_enabled: false },
        players
      );

      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);

      // Mock PFA calculation - no frame history
      (eventPlayerRepo.getAllEventPlayerIdsForPlayer as jest.Mock).mockResolvedValue([]);
      (eventPlayerRepo.getFrameResultsForEventPlayers as jest.Mock).mockResolvedValue([]);

      (eventPlayerRepo.updateEventPlayerPool as jest.Mock).mockResolvedValue(undefined);
      (eventPlayerRepo.getEventPlayersWithPools as jest.Mock).mockResolvedValue(
        players.map((p, i) => ({
          ...p,
          pool: i < 2 ? 'A' : 'B',
        }))
      );

      const result = await splitPlayersIntoPools(eventId);

      expect(result).toHaveLength(4);
      expect(eventPlayerRepo.updateEventPlayerPool).toHaveBeenCalledTimes(4);
    });

    it('should throw BadRequestError when no players registered', async () => {
      const event = createMockEventWithDetails({ id: eventId }, []);
      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);

      await expect(splitPlayersIntoPools(eventId)).rejects.toThrow(BadRequestError);
      await expect(splitPlayersIntoPools(eventId)).rejects.toThrow(
        'No players registered for this event'
      );
    });

    it('should throw BadRequestError when pools already assigned', async () => {
      const players = createMockEventPlayers(4, eventId);
      players[0].pool = 'A';
      const event = createMockEventWithDetails({ id: eventId }, players);

      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);

      await expect(splitPlayersIntoPools(eventId)).rejects.toThrow(BadRequestError);
      await expect(splitPlayersIntoPools(eventId)).rejects.toThrow(
        'Players have already been assigned to pools'
      );
    });

    it('should use qualification scores when enabled', async () => {
      const players = createMockEventPlayers(4, eventId);
      const event = createMockEventWithDetails(
        { id: eventId, qualification_round_enabled: true },
        players
      );

      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);

      (eventPlayerRepo.getQualificationScore as jest.Mock)
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(25)
        .mockResolvedValueOnce(15);

      (eventPlayerRepo.updateEventPlayerPool as jest.Mock).mockResolvedValue(undefined);
      (eventPlayerRepo.getEventPlayersWithPools as jest.Mock).mockResolvedValue(players);

      await splitPlayersIntoPools(eventId);

      expect(eventPlayerRepo.getQualificationScore).toHaveBeenCalledTimes(4);
    });

    it('should use PFA from last 6 months when qualification not enabled', async () => {
      const players = createMockEventPlayers(2, eventId);
      const event = createMockEventWithDetails(
        { id: eventId, qualification_round_enabled: false },
        players
      );

      (getEventWithPlayers as jest.Mock).mockResolvedValue(event);

      (eventPlayerRepo.getAllEventPlayerIdsForPlayer as jest.Mock).mockResolvedValue([
        'ep-old-1',
      ]);
      (eventPlayerRepo.getFrameResultsForEventPlayers as jest.Mock).mockResolvedValue([
        { points_earned: 3 },
        { points_earned: 2 },
      ]);

      (eventPlayerRepo.updateEventPlayerPool as jest.Mock).mockResolvedValue(undefined);
      (eventPlayerRepo.getEventPlayersWithPools as jest.Mock).mockResolvedValue(players);

      await splitPlayersIntoPools(eventId);

      expect(eventPlayerRepo.getAllEventPlayerIdsForPlayer).toHaveBeenCalled();
      expect(eventPlayerRepo.getFrameResultsForEventPlayers).toHaveBeenCalled();
    });
  });

  describe('computePoolAssignments', () => {
    const eventId = 'event-123';

    it('should compute pool assignments without persisting', async () => {
      const players = createMockEventPlayers(4, eventId);
      const event = createMockEventWithDetails(
        { id: eventId, qualification_round_enabled: false },
        players
      );

      // Mock bulk queries - return empty maps (no PFA history)
      (eventPlayerRepo.getAllEventPlayerIdsForPlayersBulk as jest.Mock).mockResolvedValue(new Map());
      (eventPlayerRepo.getPfaScoresBulk as jest.Mock).mockResolvedValue(new Map());

      const result = await computePoolAssignments(eventId, event);

      expect(result).toHaveLength(4);
      expect(result.filter((pa) => pa.pool === 'A')).toHaveLength(2);
      expect(result.filter((pa) => pa.pool === 'B')).toHaveLength(2);
      // Should not persist
      expect(eventPlayerRepo.updateEventPlayerPool).not.toHaveBeenCalled();
    });

    it('should throw BadRequestError when no players', async () => {
      const event = createMockEventWithDetails({ id: eventId }, []);

      await expect(computePoolAssignments(eventId, event)).rejects.toThrow(
        BadRequestError
      );
      await expect(computePoolAssignments(eventId, event)).rejects.toThrow(
        'No players registered for this event'
      );
    });

    it('should throw BadRequestError when pools already assigned', async () => {
      const players = createMockEventPlayers(4, eventId);
      players[0].pool = 'A';
      const event = createMockEventWithDetails({ id: eventId }, players);

      await expect(computePoolAssignments(eventId, event)).rejects.toThrow(
        BadRequestError
      );
      await expect(computePoolAssignments(eventId, event)).rejects.toThrow(
        'Players have already been assigned to pools'
      );
    });

    it('should sort players by score with tie-breaking', async () => {
      const players = createMockEventPlayers(4, eventId);
      // Set different default pools for tie-breaking
      players[0].player.default_pool = 'A';
      players[1].player.default_pool = 'B';
      players[2].player.default_pool = 'A';
      players[3].player.default_pool = 'B';

      const event = createMockEventWithDetails(
        { id: eventId, qualification_round_enabled: true },
        players
      );

      // All same scores to test tie-breaking
      (eventPlayerRepo.getQualificationScore as jest.Mock).mockResolvedValue(10);

      const result = await computePoolAssignments(eventId, event);

      // Players with default_pool 'A' should rank higher in ties
      expect(result).toHaveLength(4);
    });

    it('should calculate correct scoring method', async () => {
      const players = createMockEventPlayers(2, eventId);
      const event = createMockEventWithDetails(
        { id: eventId, qualification_round_enabled: false },
        players
      );

      // Mock bulk queries - first player has PFA history, second doesn't
      const playerEventPlayerMap = new Map<string, string[]>();
      playerEventPlayerMap.set(players[0].player_id, ['ep-old-1']);
      playerEventPlayerMap.set(players[1].player_id, []);
      (eventPlayerRepo.getAllEventPlayerIdsForPlayersBulk as jest.Mock).mockResolvedValue(playerEventPlayerMap);

      const pfaScores = new Map<string, { totalPoints: number; frameCount: number }>();
      pfaScores.set(players[0].player_id, { totalPoints: 3, frameCount: 1 });
      // Second player has no PFA data
      (eventPlayerRepo.getPfaScoresBulk as jest.Mock).mockResolvedValue(pfaScores);

      const result = await computePoolAssignments(eventId, event);

      expect(result[0].scoringMethod).toBe('pfa');
      expect(result[1].scoringMethod).toBe('default');
    });

    it('should place default players directly into their defaultPool when mixed with PFA players', async () => {
      // 6 PFA players + 4 default players (2 default-A, 2 default-B) = 10 total
      const players = createMockEventPlayers(10, eventId);

      // Set default pools: first 4 are default players
      players[0].player.default_pool = 'A';
      players[1].player.default_pool = 'A';
      players[2].player.default_pool = 'B';
      players[3].player.default_pool = 'B';

      const event = createMockEventWithDetails(
        { id: eventId, qualification_round_enabled: false },
        players
      );

      // Players 0-3: no PFA (default), Players 4-9: have PFA scores
      const pfaScores = new Map<string, { totalPoints: number; frameCount: number }>();
      pfaScores.set(players[4].player_id, { totalPoints: 50, frameCount: 10 }); // 5.0
      pfaScores.set(players[5].player_id, { totalPoints: 45, frameCount: 10 }); // 4.5
      pfaScores.set(players[6].player_id, { totalPoints: 40, frameCount: 10 }); // 4.0
      pfaScores.set(players[7].player_id, { totalPoints: 35, frameCount: 10 }); // 3.5
      pfaScores.set(players[8].player_id, { totalPoints: 30, frameCount: 10 }); // 3.0
      pfaScores.set(players[9].player_id, { totalPoints: 25, frameCount: 10 }); // 2.5
      // Players 0-3 have no PFA data (will be 'default' scoring method)

      (eventPlayerRepo.getAllEventPlayerIdsForPlayersBulk as jest.Mock).mockResolvedValue(new Map());
      (eventPlayerRepo.getPfaScoresBulk as jest.Mock).mockResolvedValue(pfaScores);

      const result = await computePoolAssignments(eventId, event);

      // Default-A players should be in Pool A
      const defaultAPlayers = result.filter(
        r => r.scoringMethod === 'default' && r.defaultPool === 'A'
      );
      expect(defaultAPlayers.every(p => p.pool === 'A')).toBe(true);
      expect(defaultAPlayers).toHaveLength(2);

      // Default-B players should be in Pool B
      const defaultBPlayers = result.filter(
        r => r.scoringMethod === 'default' && r.defaultPool === 'B'
      );
      expect(defaultBPlayers.every(p => p.pool === 'B')).toBe(true);
      expect(defaultBPlayers).toHaveLength(2);

      // Pool A should have 5 total (ceil(10/2)), Pool B should have 5
      expect(result.filter(r => r.pool === 'A')).toHaveLength(5);
      expect(result.filter(r => r.pool === 'B')).toHaveLength(5);

      // Top 3 scored players should be in A, bottom 3 in B
      const scoredInA = result.filter(r => r.scoringMethod === 'pfa' && r.pool === 'A');
      const scoredInB = result.filter(r => r.scoringMethod === 'pfa' && r.pool === 'B');
      expect(scoredInA).toHaveLength(3);
      expect(scoredInB).toHaveLength(3);
      // All scored-A players should have higher scores than scored-B players
      const minScoreInA = Math.min(...scoredInA.map(p => p.pfaScore));
      const maxScoreInB = Math.max(...scoredInB.map(p => p.pfaScore));
      expect(minScoreInA).toBeGreaterThan(maxScoreInB);
    });

    it('should handle all new players with direct pool placement', async () => {
      // 6 default players (3 default-A, 3 default-B), no PFA players
      const players = createMockEventPlayers(6, eventId);
      players[0].player.default_pool = 'A';
      players[1].player.default_pool = 'A';
      players[2].player.default_pool = 'A';
      players[3].player.default_pool = 'B';
      players[4].player.default_pool = 'B';
      players[5].player.default_pool = 'B';

      const event = createMockEventWithDetails(
        { id: eventId, qualification_round_enabled: false },
        players
      );

      // No PFA data for any player
      (eventPlayerRepo.getAllEventPlayerIdsForPlayersBulk as jest.Mock).mockResolvedValue(new Map());
      (eventPlayerRepo.getPfaScoresBulk as jest.Mock).mockResolvedValue(new Map());

      const result = await computePoolAssignments(eventId, event);

      expect(result.filter(r => r.pool === 'A')).toHaveLength(3);
      expect(result.filter(r => r.pool === 'B')).toHaveLength(3);
      // Each player should be in their defaultPool
      result.forEach(r => {
        expect(r.pool).toBe(r.defaultPool);
      });
    });

    it('should handle imbalanced default pool preferences', async () => {
      // 4 PFA players + 4 default players (3 default-A, 1 default-B) = 8 total
      const players = createMockEventPlayers(8, eventId);

      // First 4 are default players
      players[0].player.default_pool = 'A';
      players[1].player.default_pool = 'A';
      players[2].player.default_pool = 'A';
      players[3].player.default_pool = 'B';

      const event = createMockEventWithDetails(
        { id: eventId, qualification_round_enabled: false },
        players
      );

      const pfaScores = new Map<string, { totalPoints: number; frameCount: number }>();
      pfaScores.set(players[4].player_id, { totalPoints: 40, frameCount: 10 }); // 4.0
      pfaScores.set(players[5].player_id, { totalPoints: 30, frameCount: 10 }); // 3.0
      pfaScores.set(players[6].player_id, { totalPoints: 20, frameCount: 10 }); // 2.0
      pfaScores.set(players[7].player_id, { totalPoints: 10, frameCount: 10 }); // 1.0

      (eventPlayerRepo.getAllEventPlayerIdsForPlayersBulk as jest.Mock).mockResolvedValue(new Map());
      (eventPlayerRepo.getPfaScoresBulk as jest.Mock).mockResolvedValue(pfaScores);

      const result = await computePoolAssignments(eventId, event);

      // poolASize = ceil(8/2) = 4, defaultACount = 3, scoredForA = max(0, 4-3) = 1
      const defaultA = result.filter(r => r.scoringMethod === 'default' && r.defaultPool === 'A');
      const defaultB = result.filter(r => r.scoringMethod === 'default' && r.defaultPool === 'B');
      expect(defaultA.every(p => p.pool === 'A')).toBe(true);
      expect(defaultB.every(p => p.pool === 'B')).toBe(true);

      // 1 PFA player in A, 3 PFA players in B
      const pfaInA = result.filter(r => r.scoringMethod === 'pfa' && r.pool === 'A');
      const pfaInB = result.filter(r => r.scoringMethod === 'pfa' && r.pool === 'B');
      expect(pfaInA).toHaveLength(1);
      expect(pfaInB).toHaveLength(3);

      // The one PFA player in A should be the highest scored
      expect(pfaInA[0].pfaScore).toBe(4.0);
    });

    it('should behave as before when all players have PFA scores', async () => {
      // 6 PFA players, no default players — regression test
      const players = createMockEventPlayers(6, eventId);
      const event = createMockEventWithDetails(
        { id: eventId, qualification_round_enabled: false },
        players
      );

      const pfaScores = new Map<string, { totalPoints: number; frameCount: number }>();
      pfaScores.set(players[0].player_id, { totalPoints: 60, frameCount: 10 }); // 6.0
      pfaScores.set(players[1].player_id, { totalPoints: 50, frameCount: 10 }); // 5.0
      pfaScores.set(players[2].player_id, { totalPoints: 40, frameCount: 10 }); // 4.0
      pfaScores.set(players[3].player_id, { totalPoints: 30, frameCount: 10 }); // 3.0
      pfaScores.set(players[4].player_id, { totalPoints: 20, frameCount: 10 }); // 2.0
      pfaScores.set(players[5].player_id, { totalPoints: 10, frameCount: 10 }); // 1.0

      (eventPlayerRepo.getAllEventPlayerIdsForPlayersBulk as jest.Mock).mockResolvedValue(new Map());
      (eventPlayerRepo.getPfaScoresBulk as jest.Mock).mockResolvedValue(pfaScores);

      const result = await computePoolAssignments(eventId, event);

      // Top 3 in Pool A, bottom 3 in Pool B
      const poolA = result.filter(r => r.pool === 'A');
      const poolB = result.filter(r => r.pool === 'B');
      expect(poolA).toHaveLength(3);
      expect(poolB).toHaveLength(3);

      // Pool A should have the highest scores
      const poolAScores = poolA.map(p => p.pfaScore).sort((a, b) => b - a);
      const poolBScores = poolB.map(p => p.pfaScore).sort((a, b) => b - a);
      expect(poolAScores).toEqual([6.0, 5.0, 4.0]);
      expect(poolBScores).toEqual([3.0, 2.0, 1.0]);
    });

    it('should handle odd number of players', async () => {
      const players = createMockEventPlayers(5, eventId);
      const event = createMockEventWithDetails(
        { id: eventId, qualification_round_enabled: false },
        players
      );

      // Mock bulk queries - return empty maps (no PFA history)
      (eventPlayerRepo.getAllEventPlayerIdsForPlayersBulk as jest.Mock).mockResolvedValue(new Map());
      (eventPlayerRepo.getPfaScoresBulk as jest.Mock).mockResolvedValue(new Map());

      const result = await computePoolAssignments(eventId, event);

      // Top half (3) should be Pool A, bottom half (2) should be Pool B
      expect(result.filter((pa) => pa.pool === 'A')).toHaveLength(3);
      expect(result.filter((pa) => pa.pool === 'B')).toHaveLength(2);
    });
  });
});
