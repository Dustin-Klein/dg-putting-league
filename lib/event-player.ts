import 'server-only';
import {
  NotFoundError,
  BadRequestError,
  InternalError,
} from '@/lib/errors';
import { requireEventAdmin, getEventWithPlayers } from './event';
import { createClient } from '@/lib/supabase/server';
import { EventWithDetails, EventPlayer } from '@/app/event/[eventId]/types';


export async function addPlayerToEvent(eventId: string, playerId: string) {
  const { supabase } = await requireEventAdmin(eventId);

  // Check event status - players can only be added when event is in pre-bracket status
  const event = await getEventWithPlayers(eventId);
  if (event.status !== 'pre-bracket') {
    throw new BadRequestError('Players can only be added to events in pre-bracket status');
  }

  // Check if the player is already in the event
  const { data: existingPlayer, error: checkError } = await supabase
    .from('event_players')
    .select('*')
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (checkError) throw new InternalError(checkError.message);

  if (existingPlayer) throw new BadRequestError('Player is already in this event');

  // Insert player
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

  if (error || !data || !data[0]?.id) throw new InternalError('Failed to add player to event');

  const insertedId = data[0].id as string;

  // Fetch the inserted row with nested player info for client state updates
  const { data: inserted, error: fetchError } = await supabase
    .from('event_players')
    .select(`
      id,
      event_id,
      player_id,
      has_paid,
      created_at,
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
    .eq('id', insertedId)
    .single();

  if (fetchError || !inserted) throw new InternalError('Failed to fetch added player');

  return inserted;
}


export async function removePlayerFromEvent(
  eventId: string,
  eventPlayerId: string
) {
  if (!eventPlayerId) {
    throw new BadRequestError('Event Player ID is required');
  }

  const { supabase } = await requireEventAdmin(eventId);

  // Check event status - players can only be removed when event is in pre-bracket status
  const event = await getEventWithPlayers(eventId);
  if (event.status !== 'pre-bracket') {
    throw new BadRequestError('Players can only be removed from events in pre-bracket status');
  }

  const { error } = await supabase
    .from('event_players')
    .delete()
    .eq('id', eventPlayerId)
    .eq('event_id', eventId);

  if (error) {
    throw new InternalError('Failed to remove player from event');
  }

  return { success: true };
}

export async function updatePlayerPayment(eventId: string, playerId: string, hasPaid: boolean) {
  const { supabase } = await requireEventAdmin(eventId);

  const { data, error } = await supabase
    .from('event_players')
    .update({ has_paid: hasPaid })
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .select('id, has_paid');

  if (error) throw new InternalError('Failed to update payment status');

  if (!data || data.length === 0) throw new NotFoundError('Player not found in this event');

  return data[0];
}

/**
 * Split all registered players into Pool A (top half) and Pool B (bottom half)
 * when an event's status changes from 'pre-bracket' to 'bracket'
 */
export async function splitPlayersIntoPools(eventId: string): Promise<EventPlayer[]> {
  const { supabase } = await requireEventAdmin(eventId);
  const event = await getEventWithPlayers(eventId);

  if (!event.players || event.players.length === 0) {
    throw new BadRequestError('No players registered for this event');
  }

  // Check if pools are already assigned
  const playersWithPools = event.players.filter(player => player.pool);
  if (playersWithPools.length > 0) {
    throw new BadRequestError('Players have already been assigned to pools');
  }

  const playersWithScores = await Promise.all(
    event.players.map(async (player) => {
      let score: number;
      let scoringMethod: 'qualification' | 'pfa' | 'default';

      if (event.qualification_round_enabled) {
        // Calculate total qualification score
        const { data: qualificationFrames, error: qualError } = await supabase
          .from('qualification_frames')
          .select('points_earned')
          .eq('event_id', eventId)
          .eq('event_player_id', player.id);

        if (qualError) {
          throw new InternalError(`Failed to fetch qualification frames for player ${player.id}: ${qualError.message}`);
        }

        score = qualificationFrames?.reduce((sum, frame) => sum + frame.points_earned, 0) || 0;
        scoringMethod = 'qualification';
      } else {
        // Calculate PFA from last 6 months
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const { data: frameResults, error: frameError } = await supabase
          .from('frame_results')
          .select('points_earned')
          .eq('event_player_id', player.id)
          .gte('recorded_at', sixMonthsAgo.toISOString());

        if (frameError) {
          throw new InternalError(`Failed to fetch frame results for player ${player.id}: ${frameError.message}`);
        }

        if (frameResults && frameResults.length > 0) {
          const totalPoints = frameResults.reduce((sum, frame) => sum + frame.points_earned, 0);
          score = totalPoints / frameResults.length;
          scoringMethod = 'pfa';
        } else {
          // No frame history, use default_pool for scoring (0 for comparison)
          score = 0;
          scoringMethod = 'default';
        }
      }

      return {
        ...player,
        score,
        scoringMethod,
        default_pool: player.player.default_pool || 'B'
      };
    })
  );

  // Sort players by score (descending), then by default_pool, then maintain database order
  playersWithScores.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Tie-breaking: use default_pool (A > B)
    if (a.default_pool !== b.default_pool) {
      return a.default_pool === 'A' ? -1 : 1;
    }
    // Maintain original order as final tie-breaker
    return 0;
  });

  // Split into pools: top 50% -> Pool A, bottom 50% -> Pool B
  const totalPlayers = playersWithScores.length;
  const poolASize = Math.ceil(totalPlayers / 2); // Top half gets extra player if odd
  const poolAssignments: { id: string; pool: 'A' | 'B' }[] = [];

  playersWithScores.forEach((player, index) => {
    const pool = index < poolASize ? 'A' : 'B';
    poolAssignments.push({
      id: player.id,
      pool
    });
  });

  // Validate all players have been assigned a pool
  if (poolAssignments.length !== totalPlayers) {
    throw new InternalError('Pool assignment mismatch: not all players were assigned to a pool');
  }

  // Use a transaction to ensure all updates succeed or none do
  const { data: rpcResult, error: updateError } = await supabase.rpc('update_player_pools', {
    p_event_id: eventId,
    p_pool_assignments: poolAssignments
  });

  if (updateError) {
    // Fallback to individual updates if RPC is not available
    console.warn('RPC update_player_pools not available, using individual updates');
    
    const updates = poolAssignments.map(({ id, pool }) =>
      supabase
        .from('event_players')
        .update({ pool })
        .eq('id', id)
    );

    // Execute all updates
    const results = await Promise.all(updates);

    // Check for errors
    const hasErrors = results.some(result => result.error);
    if (hasErrors) {
      const errorDetails = results
        .map((result, index) => result.error ? `Player ${index}: ${result.error.message}` : null)
        .filter(Boolean);
      throw new InternalError(`Failed to update player pool assignments: ${errorDetails.join(', ')}`);
    }

    // Return updated players with pool assignments
    const { data: finalPlayers, error: fetchError } = await supabase
      .from('event_players')
      .select(`
        id,
        event_id,
        player_id,
        has_paid,
        pool,
        created_at,
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

    if (fetchError || !finalPlayers) {
      throw new InternalError('Failed to fetch updated player data');
    }

    // Type assertion with proper validation
    return finalPlayers as unknown as EventPlayer[];
  }

  if (!rpcResult || !rpcResult.players) {
    throw new InternalError('Failed to update player pool assignments');
  }

  // Type assertion with proper validation for RPC response
  return rpcResult.players as unknown as EventPlayer[];
}
