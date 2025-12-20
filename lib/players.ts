import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  UnauthorizedError,
  BadRequestError,
  InternalError,
} from '@/lib/errors';
import { requireAuthenticatedUser } from './league-auth';

type CreatePlayerInput = {
  name: string;
  email?: string;
  nickname?: string;
  defaultPool?: 'A' | 'B';
};

export async function createPlayer(input: CreatePlayerInput) {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser();

  const { name, email, nickname, defaultPool } = input;

  if (!name) {
    throw new BadRequestError('Name is required');
  }

  // Check for existing player by email
  if (email) {
    const { data: existingPlayer, error: existingError } = await supabase
      .from('players')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingError) {
      throw new InternalError('Failed to check existing player');
    }

    if (existingPlayer) {
      const err = new BadRequestError(
        'A player with this email already exists'
      );
      // attach metadata if needed by the route
      (err as any).playerId = existingPlayer.id;
      throw err;
    }
  }

  const playerData: Record<string, any> = {
    full_name: name,
    email,
    created_at: new Date().toISOString(),
  };

  if (nickname) playerData.nickname = nickname;
  if (defaultPool) playerData.default_pool = defaultPool;

  const { data: newPlayer, error } = await supabase
    .from('players')
    .insert(playerData)
    .select('id')
    .single();

  if (error || !newPlayer) {
    console.error('Error creating player:', error);
    throw new InternalError('Failed to create player');
  }

  return {
    id: newPlayer.id,
  };
}

export type PlayerSearchResult = {
  id: string;
  full_name: string;
  player_number: number | null;
};

export async function searchPlayers(query: string | null, excludeEventId?: string) {
  if (!query) {
    return [];
  }

  const supabase = await createClient();
  const user = await requireAuthenticatedUser();

  const numericQuery = Number(query);
  const isNumeric = !Number.isNaN(numericQuery);

  // First, get the base query for player search
  let queryBuilder = supabase
    .from('players')
    .select('id, full_name, player_number')
    .or(
      [
        `full_name.ilike.%${query}%`,
        isNumeric ? `player_number.eq.${numericQuery}` : null,
      ]
        .filter(Boolean)
        .join(',')
    )
    .limit(10);

  // If we need to exclude players already in an event
  if (excludeEventId) {
    // Get players already in the event
    const { data: eventPlayers, error: eventPlayersError } = await supabase
      .from('event_players')
      .select('player_id')
      .eq('event_id', excludeEventId);

    if (eventPlayersError) {
      console.error('Error fetching event players:', eventPlayersError);
      throw new InternalError('Failed to fetch event players');
    }

    // Exclude players already in the event
    const playerIdsToExclude = eventPlayers.map(ep => ep.player_id);
    if (playerIdsToExclude.length > 0) {
      queryBuilder = queryBuilder.not('id', 'in', `(${playerIdsToExclude.join(',')})`);
    }
  }

  const { data: players, error } = await queryBuilder;

  if (error) {
    console.error('Error searching players:', error);
    throw new InternalError('Failed to search players');
  }

  return players ?? [];
}