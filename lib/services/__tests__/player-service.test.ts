/**
 * Player Service Tests
 *
 * Tests for player management functions:
 * - createPlayer()
 * - searchPlayers()
 */

import { BadRequestError } from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockUser,
  createMockPlayer,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/services/auth', () => ({
  requireAuthenticatedUser: jest.fn(),
}));

jest.mock('@/lib/repositories/player-repository', () => ({
  getPlayerByEmail: jest.fn(),
  insertPlayer: jest.fn(),
  searchPlayersByName: jest.fn(),
  searchPlayersByNumber: jest.fn(),
  getPlayerIdsInEvent: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { requireAuthenticatedUser } from '@/lib/services/auth';
import * as playerRepo from '@/lib/repositories/player-repository';
import { createPlayer, searchPlayers } from '../player/player-service';

describe('Player Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireAuthenticatedUser as jest.Mock).mockResolvedValue(createMockUser());
  });

  describe('createPlayer', () => {
    const validInput = {
      name: 'John Doe',
      email: 'john@example.com',
      nickname: 'Johnny',
      defaultPool: 'A' as const,
    };

    it('should create a player successfully with all fields', async () => {
      const expectedPlayer = { id: 'player-123' };
      (playerRepo.getPlayerByEmail as jest.Mock).mockResolvedValue(null);
      (playerRepo.insertPlayer as jest.Mock).mockResolvedValue(expectedPlayer);

      const result = await createPlayer(validInput);

      expect(result).toEqual(expectedPlayer);
      expect(requireAuthenticatedUser).toHaveBeenCalled();
      expect(playerRepo.getPlayerByEmail).toHaveBeenCalledWith(mockSupabase, 'john@example.com');
      expect(playerRepo.insertPlayer).toHaveBeenCalledWith(mockSupabase, {
        full_name: 'John Doe',
        email: 'john@example.com',
        nickname: 'Johnny',
        default_pool: 'A',
      });
    });

    it('should create a player without optional fields', async () => {
      const minimalInput = { name: 'Jane Doe', email: 'jane@example.com' };
      const expectedPlayer = { id: 'player-456' };
      (playerRepo.getPlayerByEmail as jest.Mock).mockResolvedValue(null);
      (playerRepo.insertPlayer as jest.Mock).mockResolvedValue(expectedPlayer);

      const result = await createPlayer(minimalInput);

      expect(result).toEqual(expectedPlayer);
      expect(playerRepo.getPlayerByEmail).toHaveBeenCalledWith(mockSupabase, 'jane@example.com');
      expect(playerRepo.insertPlayer).toHaveBeenCalledWith(mockSupabase, {
        full_name: 'Jane Doe',
        email: 'jane@example.com',
        nickname: undefined,
        default_pool: undefined,
      });
    });

    it('should throw BadRequestError when name is empty', async () => {
      await expect(createPlayer({ name: '', email: 'test@example.com' })).rejects.toThrow(BadRequestError);
      await expect(createPlayer({ name: '', email: 'test@example.com' })).rejects.toThrow('Name is required');
    });

    it('should throw BadRequestError when name is missing', async () => {
      await expect(createPlayer({} as { name: string; email: string })).rejects.toThrow(BadRequestError);
    });

    it('should throw BadRequestError when email already exists', async () => {
      const existingPlayer = createMockPlayer({ id: 'existing-player-123' });
      (playerRepo.getPlayerByEmail as jest.Mock).mockResolvedValue(existingPlayer);

      await expect(createPlayer(validInput)).rejects.toThrow(
        expect.objectContaining({
          name: 'BadRequestError',
          message: 'A player with this email already exists',
          playerId: 'existing-player-123',
        })
      );
    });

    it('should throw BadRequestError when email is missing', async () => {
      const inputWithoutEmail = { name: 'No Email Player' } as { name: string; email: string };

      await expect(createPlayer(inputWithoutEmail)).rejects.toThrow(BadRequestError);
      await expect(createPlayer(inputWithoutEmail)).rejects.toThrow('Email is required');
    });

    it('should require authentication', async () => {
      (requireAuthenticatedUser as jest.Mock).mockRejectedValue(
        new Error('Not authenticated')
      );

      await expect(createPlayer(validInput)).rejects.toThrow('Not authenticated');
    });
  });

  describe('searchPlayers', () => {
    it('should return empty array when query is null', async () => {
      const result = await searchPlayers(null);

      expect(result).toEqual([]);
      expect(playerRepo.searchPlayersByName).not.toHaveBeenCalled();
    });

    it('should return empty array when query is empty string', async () => {
      const result = await searchPlayers('');

      expect(result).toEqual([]);
    });

    it('should search by name for text queries', async () => {
      const mockPlayers = [
        createMockPlayer({ id: 'p1', full_name: 'John Doe' }),
        createMockPlayer({ id: 'p2', full_name: 'Johnny Smith' }),
      ];
      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue(mockPlayers);

      const result = await searchPlayers('John');

      expect(result).toEqual(mockPlayers);
      expect(playerRepo.searchPlayersByName).toHaveBeenCalledWith(mockSupabase, 'John', 10);
      expect(playerRepo.searchPlayersByNumber).not.toHaveBeenCalled();
    });

    it('should search by both name and number for numeric queries', async () => {
      const byNamePlayers = [createMockPlayer({ id: 'p1', full_name: 'Player 42' })];
      const byNumberPlayers = [createMockPlayer({ id: 'p2', player_number: 42 })];

      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue(byNamePlayers);
      (playerRepo.searchPlayersByNumber as jest.Mock).mockResolvedValue(byNumberPlayers);

      const result = await searchPlayers('42');

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(byNamePlayers[0]);
      expect(result).toContainEqual(byNumberPlayers[0]);
      expect(playerRepo.searchPlayersByName).toHaveBeenCalledWith(mockSupabase, '42', 10);
      expect(playerRepo.searchPlayersByNumber).toHaveBeenCalledWith(mockSupabase, 42, 10);
    });

    it('should deduplicate results when same player found by name and number', async () => {
      const samePlayer = createMockPlayer({ id: 'p1', full_name: 'Player 42', player_number: 42 });

      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue([samePlayer]);
      (playerRepo.searchPlayersByNumber as jest.Mock).mockResolvedValue([samePlayer]);

      const result = await searchPlayers('42');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
    });

    it('should exclude players already in event when excludeEventId provided', async () => {
      const players = [
        createMockPlayer({ id: 'p1' }),
        createMockPlayer({ id: 'p2' }),
        createMockPlayer({ id: 'p3' }),
      ];
      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue(players);
      (playerRepo.getPlayerIdsInEvent as jest.Mock).mockResolvedValue(['p2']);

      const result = await searchPlayers('Player', 'event-123');

      expect(result).toHaveLength(2);
      expect(result.map((p) => p.id)).toEqual(['p1', 'p3']);
      expect(playerRepo.getPlayerIdsInEvent).toHaveBeenCalledWith(mockSupabase, 'event-123');
    });

    it('should escape special characters in search query', async () => {
      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue([]);

      await searchPlayers('test%user_name\\special');

      expect(playerRepo.searchPlayersByName).toHaveBeenCalledWith(
        mockSupabase,
        'test\\%user\\_name\\\\special',
        10
      );
      expect(playerRepo.searchPlayersByNumber).not.toHaveBeenCalled();
    });

    it('should trim whitespace from query', async () => {
      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue([]);

      await searchPlayers('  John  ');

      expect(playerRepo.searchPlayersByName).toHaveBeenCalledWith(mockSupabase, 'John', 10);
    });

    it('should require authentication', async () => {
      (requireAuthenticatedUser as jest.Mock).mockRejectedValue(
        new Error('Not authenticated')
      );

      await expect(searchPlayers('test')).rejects.toThrow('Not authenticated');
    });

    it('should handle numeric string with leading zeros', async () => {
      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue([]);
      (playerRepo.searchPlayersByNumber as jest.Mock).mockResolvedValue([]);

      await searchPlayers('007');

      expect(playerRepo.searchPlayersByNumber).toHaveBeenCalledWith(mockSupabase, 7, 10);
    });

    it('should not search by number for non-numeric strings', async () => {
      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue([]);

      await searchPlayers('abc123');

      expect(playerRepo.searchPlayersByName).toHaveBeenCalled();
      expect(playerRepo.searchPlayersByNumber).not.toHaveBeenCalled();
    });
  });
});
