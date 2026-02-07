import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { BadRequestError } from '@/lib/errors';
import { requireAuthenticatedUser } from '@/lib/services/auth';
import * as playerRepo from '@/lib/repositories/player-repository';

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
  const supabase = await createClient();
  await requireAuthenticatedUser();

  const { name, email, nickname, defaultPool } = input;

  if (!name) {
    throw new BadRequestError('Name is required');
  }

  if (!email) {
    throw new BadRequestError('Email is required');
  }

  // Check for existing player by email
  {
    const existingPlayer = await playerRepo.getPlayerByEmail(supabase, email);

    if (existingPlayer) {
      const err = new BadRequestError(
        'A player with this email already exists'
      );
      // attach metadata if needed by the route
      (err as unknown as { playerId: string }).playerId = existingPlayer.id;
      throw err;
    }
  }

  return playerRepo.insertPlayer(supabase, {
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

  const supabase = await createClient();
  await requireAuthenticatedUser();

  return searchPlayersInternal(supabase, query, excludeEventId);
}

/**
 * Search for players by name or player number (public, no auth required)
 */
export async function searchPlayersPublic(query: string | null) {
  if (!query) {
    return [];
  }

  const supabase = await createClient();
  return searchPlayersInternal(supabase, query);
}

async function searchPlayersInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  query: string,
  excludeEventId?: string
) {
  // Sanitize and validate input to prevent filter injection
  const trimmed = query.trim();
  // Escape \, % and _ used by LIKE to avoid unintended wildcards
  const escaped = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`);

  // Search by name
  let players = await playerRepo.searchPlayersByName(supabase, escaped, 10);

  // If numeric, also search by player number
  const numericQuery = Number(trimmed);
  const isNumeric = !Number.isNaN(numericQuery);

  if (isNumeric) {
    const byNumber = await playerRepo.searchPlayersByNumber(supabase, numericQuery, 10);
    const seen = new Set(players.map((p) => p.id));
    for (const p of byNumber) {
      if (!seen.has(p.id)) players.push(p);
    }
  }

  // If we need to exclude players already in an event
  if (excludeEventId) {
    const excludeIds = await playerRepo.getPlayerIdsInEvent(supabase, excludeEventId);
    const excludeSet = new Set(excludeIds);
    players = players.filter((p) => !excludeSet.has(p.id));
  }

  return players;
}
