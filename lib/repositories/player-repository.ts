import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';
import type { PlayerSearchResult } from '@/lib/types/player';

/**
 * Insert a new player
 */
export async function insertPlayer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  playerData: {
    full_name: string;
    email?: string;
    nickname?: string;
    default_pool?: 'A' | 'B';
  }
): Promise<{ id: string }> {
  const data: Record<string, unknown> = {
    full_name: playerData.full_name,
    email: playerData.email,
    created_at: new Date().toISOString(),
  };

  if (playerData.nickname) data.nickname = playerData.nickname;
  if (playerData.default_pool) data.default_pool = playerData.default_pool;

  const { data: newPlayer, error } = await supabase
    .from('players')
    .insert(data)
    .select('id')
    .single();

  if (error || !newPlayer) {
    console.error('Error creating player:', error);
    throw new InternalError('Failed to create player');
  }

  return { id: newPlayer.id };
}

/**
 * Search players by name (full text search)
 */
export async function searchPlayersByName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  searchTerm: string,
  limit: number = 10
): Promise<PlayerSearchResult[]> {
  const escaped = searchTerm.replace(/[%_\\]/g, '\\$&');
  const { data: byName, error } = await supabase
    .from('players')
    .select('id, full_name, player_number')
    .ilike('full_name', `%${escaped}%`)
    .limit(limit);

  if (error) {
    throw new InternalError('Failed to search players by name');
  }

  return (byName || []) as PlayerSearchResult[];
}

/**
 * Search players by player number (exact match)
 */
export async function searchPlayersByNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  playerNumber: number,
  limit: number = 10
): Promise<PlayerSearchResult[]> {
  const { data: byNumber, error } = await supabase
    .from('players')
    .select('id, full_name, player_number')
    .eq('player_number', playerNumber)
    .limit(limit);

  if (error) {
    throw new InternalError('Failed to search players by number');
  }

  return (byNumber || []) as PlayerSearchResult[];
}

/**
 * Get player IDs in an event
 */
export async function getPlayerIdsInEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<string[]> {
  const { data: eventPlayers, error } = await supabase
    .from('event_players')
    .select('player_id')
    .eq('event_id', eventId);

  if (error) {
    throw new InternalError('Failed to fetch event players');
  }

  return (eventPlayers ?? []).map((ep: { player_id: string }) => ep.player_id);
}
