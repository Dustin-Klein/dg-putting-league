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

  // Sanitize and validate input to prevent filter injection
  const trimmed = query.trim();
  // Escape % and _ used by LIKE to avoid unintended wildcards
  const escaped = trimmed.replace(/[%_]/g, (m) => `\\${m}`);

  // Build a safe base query using structured filters (no string concatenated OR)
  const fullNameQuery = supabase
    .from('players')
    .select('id, full_name, player_number')
    .ilike('full_name', `%${escaped}%`)
    .limit(10);

  // If numeric, perform a separate exact-number match and merge results client-side
  const numericQuery = Number(trimmed);
  const isNumeric = !Number.isNaN(numericQuery);

  let players: PlayerSearchResult[] = [];
  let errorAgg: any = null;

  const [{ data: byName, error: nameErr }] = await Promise.all([
    fullNameQuery,
  ]);

  if (nameErr) errorAgg = nameErr;
  if (byName) players = byName as PlayerSearchResult[];

  if (isNumeric) {
    const { data: byNumber, error: numErr } = await supabase
      .from('players')
      .select('id, full_name, player_number')
      .eq('player_number', numericQuery)
      .limit(10);
    if (numErr) errorAgg = errorAgg ?? numErr;
    if (byNumber) {
      const seen = new Set(players.map((p) => p.id));
      for (const p of byNumber as PlayerSearchResult[]) {
        if (!seen.has(p.id)) players.push(p);
      }
    }
  }

  // Start a queryBuilder-like path using the merged list; exclusion happens below
  let initialResults = players;

  // If we need to exclude players already in an event
  if (excludeEventId) {
    const { data: eventPlayers, error: eventPlayersError } = await supabase
      .from('event_players')
      .select('player_id')
      .eq('event_id', excludeEventId);

    if (eventPlayersError) {
      console.error('Error fetching event players:', eventPlayersError);
      throw new InternalError('Failed to fetch event players');
    }

    const exclude = new Set((eventPlayers ?? []).map((ep: any) => ep.player_id));
    initialResults = initialResults.filter((p) => !exclude.has(p.id));
  }

  if (errorAgg) {
    console.error('Error searching players:', errorAgg);
    throw new InternalError('Failed to search players');
  }

  return initialResults ?? [];
}