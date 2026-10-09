import 'server-only';
import type { Executor } from '@/lib/db/tx';
import { BadRequestError } from '@/lib/errors';
import {
  authorizeAnyLeagueAdmin,
  authorizeAuthenticated,
  authorizeEventView,
  authorizePublicRead,
} from '@/lib/services/auth';
import * as playerRepo from '@/lib/repositories/player-repository.db';

// Re-export types for consumers
export type { PlayerSearchResult } from '@/lib/types/player';

type CreatePlayerInput = {
  name: string;
  email: string;
  nickname?: string;
  defaultPool?: 'A' | 'B';
};

/**
 * Create a new player
 */
export async function createPlayer(input: CreatePlayerInput) {
  const { pg } = await authorizeAnyLeagueAdmin();

  const { name, email, nickname, defaultPool } = input;

  if (!name) {
    throw new BadRequestError('Name is required');
  }

  if (!email) {
    throw new BadRequestError('Email is required');
  }

  return playerRepo.insertPlayer(pg, {
    full_name: name,
    email,
    nickname,
    default_pool: defaultPool,
  });
}

/**
 * Search for players by name or player number (requires authentication)
 */
export async function searchPlayers(query: string | null, excludeEventId?: string) {
  if (!query) {
    return [];
  }

  const { pg } = excludeEventId
    ? await authorizeEventView(excludeEventId)
    : await authorizeAuthenticated();

  return searchPlayersInternal(pg, query, excludeEventId);
}

/**
 * Search for players by name or player number (public, no auth required)
 */
export async function searchPlayersPublic(query: string | null) {
  if (!query) {
    return [];
  }

  const { pg } = authorizePublicRead();
  return searchPlayersInternal(pg, query);
}

async function searchPlayersInternal(
  ex: Executor,
  query: string,
  excludeEventId?: string
) {
  const trimmed = query.trim();

  // Search by name (repository handles escaping of %, _, \)
  let players = await playerRepo.searchPlayersByName(ex, trimmed, 10);

  // If numeric, also search by player number
  const numericQuery = Number(trimmed);
  // player_number is an integer column; other numbers can't match and would make Postgres error
  const isNumeric = Number.isSafeInteger(numericQuery) && numericQuery > 0 && numericQuery <= 2147483647;

  if (isNumeric) {
    const byNumber = await playerRepo.searchPlayersByNumber(ex, numericQuery, 10);
    const seen = new Set(players.map((p) => p.id));
    for (const p of byNumber) {
      if (!seen.has(p.id)) players.push(p);
    }
  }

  // If we need to exclude players already in an event
  if (excludeEventId) {
    const excludeIds = await playerRepo.getPlayerIdsInEvent(ex, excludeEventId);
    const excludeSet = new Set(excludeIds);
    players = players.filter((p) => !excludeSet.has(p.id));
  }

  return players;
}
