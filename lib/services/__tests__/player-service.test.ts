/**
 * Player Service Tests
 *
 * Tests for player management functions:
 * - createPlayer()
 * - searchPlayers()
 * - searchPlayersPublic()
 */

import { BadRequestError, NotFoundError } from '@/lib/errors';
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

jest.mock('@/lib/services/auth', () =>
  jest.requireActual('./test-utils').createAuthServiceMock()
);

jest.mock('@/lib/repositories/player-repository.db', () => ({
  insertPlayer: jest.fn(),
  searchPlayersByName: jest.fn(),
  searchPlayersByNumber: jest.fn(),
  getPlayerIdsInEvent: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import {
  requireAuthenticatedUser,
  authorizeAnyLeagueAdmin,
  authorizeAuthenticated,
  authorizeEventView,
  authorizePublicRead,
} from '@/lib/services/auth';
import * as playerRepo from '@/lib/repositories/player-repository.db';
import { createPlayer, searchPlayers, searchPlayersPublic } from '../player/player-service';

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
      (playerRepo.insertPlayer as jest.Mock).mockResolvedValue(expectedPlayer);

      const result = await createPlayer(validInput);

      expect(result).toEqual(expectedPlayer);
      expect(authorizeAnyLeagueAdmin).toHaveBeenCalled();
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
      (playerRepo.insertPlayer as jest.Mock).mockResolvedValue(expectedPlayer);

      const result = await createPlayer(minimalInput);

      expect(result).toEqual(expectedPlayer);
      expect(authorizeAnyLeagueAdmin).toHaveBeenCalled();
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

    it('should throw BadRequestError when email is missing', async () => {
      const inputWithoutEmail = { name: 'No Email Player' } as { name: string; email: string };

      await expect(createPlayer(inputWithoutEmail)).rejects.toThrow(BadRequestError);
      await expect(createPlayer(inputWithoutEmail)).rejects.toThrow('Email is required');
    });

    it('should require authentication and league admin authorization', async () => {
      (authorizeAnyLeagueAdmin as jest.Mock).mockRejectedValue(
        new Error('Only league admins can perform this action')
      );

      await expect(createPlayer(validInput)).rejects.toThrow('Only league admins can perform this action');
      expect(playerRepo.insertPlayer).not.toHaveBeenCalled();
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
      expect(playerRepo.searchPlayersByName).not.toHaveBeenCalled();
    });

    it('should search by name for text queries', async () => {
      const mockPlayers = [
        createMockPlayer({ id: 'p1', full_name: 'John Doe' }),
        createMockPlayer({ id: 'p2', full_name: 'Johnny Smith' }),
      ];
      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue(mockPlayers);

      const result = await searchPlayers('John');

      expect(result).toEqual(mockPlayers);
      expect(authorizeAuthenticated).toHaveBeenCalled();
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
      expect(authorizeEventView).toHaveBeenCalledWith('event-123');
      expect(playerRepo.getPlayerIdsInEvent).toHaveBeenCalledWith(mockSupabase, 'event-123');
    });

    it('should throw and not search when excludeEventId cannot be viewed', async () => {
      (authorizeEventView as jest.Mock).mockRejectedValueOnce(
        new NotFoundError('Event not found')
      );

      await expect(searchPlayers('Player', 'event-forbidden')).rejects.toThrow(NotFoundError);
      expect(authorizeEventView).toHaveBeenCalledWith('event-forbidden');
      expect(playerRepo.searchPlayersByName).not.toHaveBeenCalled();
      expect(playerRepo.getPlayerIdsInEvent).not.toHaveBeenCalled();
    });

    it('should pass query unescaped to repository (e.g. 50%_)', async () => {
      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue([]);

      await searchPlayers('50%_');

      expect(playerRepo.searchPlayersByName).toHaveBeenCalledWith(
        mockSupabase,
        '50%_',
        10
      );
      expect(playerRepo.searchPlayersByNumber).not.toHaveBeenCalled();
    });

    it('should trim whitespace from query', async () => {
      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue([]);

      await searchPlayers('  John  ');

      expect(playerRepo.searchPlayersByName).toHaveBeenCalledWith(mockSupabase, 'John', 10);
    });

    it('should require authentication when excludeEventId is not provided', async () => {
      (authorizeAuthenticated as jest.Mock).mockRejectedValueOnce(
        new Error('Authentication required')
      );

      await expect(searchPlayers('test')).rejects.toThrow('Authentication required');
      expect(playerRepo.searchPlayersByName).not.toHaveBeenCalled();
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

  describe('searchPlayersPublic', () => {
    it('should return empty array when query is null or empty', async () => {
      expect(await searchPlayersPublic(null)).toEqual([]);
      expect(await searchPlayersPublic('')).toEqual([]);
      expect(playerRepo.searchPlayersByName).not.toHaveBeenCalled();
    });

    it('should search players using authorizePublicRead without authentication', async () => {
      const mockPlayers = [createMockPlayer({ id: 'p1', full_name: 'Public Player' })];
      (playerRepo.searchPlayersByName as jest.Mock).mockResolvedValue(mockPlayers);

      const result = await searchPlayersPublic('Public');

      expect(result).toEqual(mockPlayers);
      expect(authorizePublicRead).toHaveBeenCalled();
      expect(playerRepo.searchPlayersByName).toHaveBeenCalledWith(expect.anything(), 'Public', 10);
    });
  });
});
