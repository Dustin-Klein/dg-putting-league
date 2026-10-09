import 'server-only';
import { eq, ilike } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { event_players, players } from '@/lib/db/schema';
import type { PlayerSearchResult } from '@/lib/types/player';

export interface InsertPlayerInput {
  full_name: string;
  email?: string;
  nickname?: string;
  default_pool?: 'A' | 'B';
}

/**
 * Insert a new player
 */
export async function insertPlayer(
  ex: Executor,
  playerData: InsertPlayerInput
): Promise<{ id: string }> {
  const [newPlayer] = await ex
    .insert(players)
    .values({
      full_name: playerData.full_name,
      email: playerData.email,
      nickname: playerData.nickname,
      default_pool: playerData.default_pool,
    })
    .returning({ id: players.id });

  return { id: newPlayer.id };
}

/**
 * Search players by name (case-insensitive substring match)
 */
export async function searchPlayersByName(
  ex: Executor,
  rawTerm: string,
  limit: number = 10
): Promise<PlayerSearchResult[]> {
  const escaped = rawTerm.replace(/[%_\\]/g, '\\$&');
  return ex
    .select({
      id: players.id,
      full_name: players.full_name,
      player_number: players.player_number,
    })
    .from(players)
    .where(ilike(players.full_name, `%${escaped}%`))
    .limit(limit);
}

/**
 * Search players by player number (exact match)
 */
export async function searchPlayersByNumber(
  ex: Executor,
  playerNumber: number,
  limit: number = 10
): Promise<PlayerSearchResult[]> {
  return ex
    .select({
      id: players.id,
      full_name: players.full_name,
      player_number: players.player_number,
    })
    .from(players)
    .where(eq(players.player_number, playerNumber))
    .limit(limit);
}

/**
 * Get player IDs in an event
 */
export async function getPlayerIdsInEvent(
  ex: Executor,
  eventId: string
): Promise<string[]> {
  const rows = await ex
    .select({ player_id: event_players.player_id })
    .from(event_players)
    .where(eq(event_players.event_id, eventId));

  return rows.map((r) => r.player_id);
}
