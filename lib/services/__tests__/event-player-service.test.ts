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

      (eventPlayerRepo.getAllEventPlayerIdsForPlayer as jest.Mock).mockResolvedValue([]);
      (eventPlayerRepo.getFrameResultsForEventPlayers as jest.Mock).mockResolvedValue([]);

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

      // First player has PFA history
      (eventPlayerRepo.getAllEventPlayerIdsForPlayer as jest.Mock)
        .mockResolvedValueOnce(['ep-old-1'])
        .mockResolvedValueOnce([]);
      (eventPlayerRepo.getFrameResultsForEventPlayers as jest.Mock)
        .mockResolvedValueOnce([{ points_earned: 3 }])
        .mockResolvedValueOnce([]);

      const result = await computePoolAssignments(eventId, event);

      expect(result[0].scoringMethod).toBe('pfa');
      expect(result[1].scoringMethod).toBe('default');
    });

    it('should handle odd number of players', async () => {
      const players = createMockEventPlayers(5, eventId);
      const event = createMockEventWithDetails(
        { id: eventId, qualification_round_enabled: false },
        players
      );

      (eventPlayerRepo.getAllEventPlayerIdsForPlayer as jest.Mock).mockResolvedValue([]);
      (eventPlayerRepo.getFrameResultsForEventPlayers as jest.Mock).mockResolvedValue([]);

      const result = await computePoolAssignments(eventId, event);

      // Top half (3) should be Pool A, bottom half (2) should be Pool B
      expect(result.filter((pa) => pa.pool === 'A')).toHaveLength(3);
      expect(result.filter((pa) => pa.pool === 'B')).toHaveLength(2);
    });
  });
});
