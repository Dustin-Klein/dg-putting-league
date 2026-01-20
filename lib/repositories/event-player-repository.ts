import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';
import type { EventPlayer } from '@/lib/types/player';

// Partial type for queries without player join
export interface EventPlayerData {
  id: string;
  event_id: string;
  player_id: string;
  created_at: string;
  has_paid: boolean;
  pool: 'A' | 'B' | null;
  pfa_score: number | null;
  scoring_method: 'qualification' | 'pfa' | 'default' | null;
}

/**
 * Check if a player already exists in an event
 */
export async function getEventPlayerByPlayerAndEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  playerId: string
): Promise<EventPlayerData | null> {
  const { data: existingPlayer, error } = await supabase
    .from('event_players')
    .select('*')
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) {
    throw new InternalError(error.message);
  }

  return existingPlayer as EventPlayerData | null;
}

/**
 * Insert a new event player
 */
export async function insertEventPlayer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  playerId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('event_players')
    .insert([
      {
        event_id: eventId,
        player_id: playerId,
        has_paid: false,
        created_at: new Date().toISOString(),
      },
    ])
    .select('id');

  if (error || !data || !data[0]?.id) {
    throw new InternalError('Failed to add player to event');
  }

  return data[0].id as string;
}

/**
 * Get event player with nested player info
 */
export async function getEventPlayer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventPlayerId: string
): Promise<EventPlayer> {
  const { data: inserted, error } = await supabase
    .from('event_players')
    .select(`
      id,
      event_id,
      player_id,
      has_paid,
      created_at,
      pool,
      pfa_score,
      scoring_method,
      player:players(
        id,
        full_name,
        nickname,
        email,
        created_at,
        default_pool,
        player_number
      )
    `)
    .eq('id', eventPlayerId)
    .single();

  if (error || !inserted) {
    throw new InternalError('Failed to fetch event player');
  }

  return inserted as unknown as EventPlayer;
}

/**
 * Get multiple event players with nested player info (bulk query)
 */
export async function getEventPlayersBulk(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventPlayerIds: string[]
): Promise<EventPlayer[]> {
  if (eventPlayerIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('event_players')
    .select(`
      id,
      event_id,
      player_id,
      has_paid,
      created_at,
      pool,
      pfa_score,
      scoring_method,
      player:players(
        id,
        full_name,
        nickname,
        email,
        created_at,
        default_pool,
        player_number
      )
    `)
    .in('id', eventPlayerIds);

  if (error) {
    throw new InternalError(`Failed to fetch event players: ${error.message}`);
  }

  return (data ?? []) as unknown as EventPlayer[];
}

/**
 * Delete an event player
 */
export async function deleteEventPlayer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  eventPlayerId: string
): Promise<void> {
  const { error } = await supabase
    .from('event_players')
    .delete()
    .eq('id', eventPlayerId)
    .eq('event_id', eventId);

  if (error) {
    throw new InternalError('Failed to remove player from event');
  }
}

/**
 * Update player payment status
 */
export async function updateEventPlayerPayment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  playerId: string,
  hasPaid: boolean
): Promise<{ id: string; has_paid: boolean } | null> {
  const { data, error } = await supabase
    .from('event_players')
    .update({ has_paid: hasPaid })
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .select('id, has_paid');

  if (error) {
    throw new InternalError('Failed to update payment status');
  }

  if (!data || data.length === 0) {
    return null;
  }

  return data[0];
}

/**
 * Get event players with pools already assigned
 */
export async function getEventPlayersWithPools(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<EventPlayer[]> {
  const { data, error } = await supabase
    .from('event_players')
    .select(`
      id,
      event_id,
      player_id,
      has_paid,
      pool,
      created_at,
      pfa_score,
      scoring_method,
      player:players(
        id,
        full_name,
        nickname,
        email,
        created_at,
        default_pool,
        player_number
      )
    `)
    .eq('event_id', eventId)
    .order('created_at');

  if (error) {
    throw new InternalError('Failed to fetch event players');
  }

  return (data ?? []) as unknown as EventPlayer[];
}

/**
 * Update event player pool assignment
 */
export async function updateEventPlayerPool(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventPlayerId: string,
  pool: 'A' | 'B',
  pfaScore: number,
  scoringMethod: 'qualification' | 'pfa' | 'default'
): Promise<void> {
  const { error } = await supabase
    .from('event_players')
    .update({ pool, pfa_score: pfaScore, scoring_method: scoringMethod })
    .eq('id', eventPlayerId);

  if (error) {
    throw new InternalError(`Failed to update player pool: ${error.message}`);
  }
}

/**
 * Get all event_player records for a player (across all events)
 */
export async function getAllEventPlayerIdsForPlayer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  playerId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('event_players')
    .select('id')
    .eq('player_id', playerId);

  if (error) {
    throw new InternalError(`Failed to fetch event players: ${error.message}`);
  }

  return (data ?? []).map(ep => ep.id);
}

/**
 * Get qualification frames total points for an event player
 */
export async function getQualificationScore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  eventPlayerId: string
): Promise<number> {
  const { data: qualificationFrames, error } = await supabase
    .from('qualification_frames')
    .select('points_earned')
    .eq('event_id', eventId)
    .eq('event_player_id', eventPlayerId);

  if (error) {
    throw new InternalError(`Failed to fetch qualification frames: ${error.message}`);
  }

  return qualificationFrames?.reduce((sum, frame) => sum + frame.points_earned, 0) || 0;
}

/**
 * Get frame results for event players within a date range
 */
export async function getFrameResultsForEventPlayers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventPlayerIds: string[],
  sinceDate: Date
): Promise<{ points_earned: number }[]> {
  if (eventPlayerIds.length === 0) {
    return [];
  }

  const { data: results, error } = await supabase
    .from('frame_results')
    .select('points_earned')
    .in('event_player_id', eventPlayerIds)
    .gte('recorded_at', sinceDate.toISOString());

  if (error) {
    throw new InternalError(`Failed to fetch frame results: ${error.message}`);
  }

  return results || [];
}

/**
 * Get all event_player IDs for multiple players in one query (bulk operation)
 * Returns a Map where key is player_id and value is array of event_player IDs
 */
export async function getAllEventPlayerIdsForPlayersBulk(
  supabase: Awaited<ReturnType<typeof createClient>>,
  playerIds: string[]
): Promise<Map<string, string[]>> {
  if (playerIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('event_players')
    .select('id, player_id')
    .in('player_id', playerIds);

  if (error) {
    throw new InternalError(`Failed to fetch event players in bulk: ${error.message}`);
  }

  const result = new Map<string, string[]>();
  for (const row of data ?? []) {
    const existing = result.get(row.player_id) || [];
    existing.push(row.id);
    result.set(row.player_id, existing);
  }

  return result;
}

/**
 * Get PFA scores for multiple players in one query (bulk operation)
 * Returns a Map where key is player_id and value is { totalPoints, frameCount }
 */
export async function getPfaScoresBulk(
  supabase: Awaited<ReturnType<typeof createClient>>,
  playerEventPlayerMap: Map<string, string[]>,
  sinceDate: Date
): Promise<Map<string, { totalPoints: number; frameCount: number }>> {
  // Collect all event_player IDs
  const allEventPlayerIds: string[] = [];
  for (const eventPlayerIds of playerEventPlayerMap.values()) {
    allEventPlayerIds.push(...eventPlayerIds);
  }

  if (allEventPlayerIds.length === 0) {
    return new Map();
  }

  // Single query to get all frame results
  const { data: results, error } = await supabase
    .from('frame_results')
    .select('event_player_id, points_earned')
    .in('event_player_id', allEventPlayerIds)
    .gte('recorded_at', sinceDate.toISOString());

  if (error) {
    throw new InternalError(`Failed to fetch frame results in bulk: ${error.message}`);
  }

  // Build reverse lookup: event_player_id -> player_id
  const eventPlayerToPlayer = new Map<string, string>();
  for (const [playerId, eventPlayerIds] of playerEventPlayerMap.entries()) {
    for (const epId of eventPlayerIds) {
      eventPlayerToPlayer.set(epId, playerId);
    }
  }

  // Aggregate results by player_id
  const playerScores = new Map<string, { totalPoints: number; frameCount: number }>();
  for (const row of results ?? []) {
    const playerId = eventPlayerToPlayer.get(row.event_player_id);
    if (playerId) {
      const existing = playerScores.get(playerId) || { totalPoints: 0, frameCount: 0 };
      existing.totalPoints += row.points_earned;
      existing.frameCount += 1;
      playerScores.set(playerId, existing);
    }
  }

  return playerScores;
}
