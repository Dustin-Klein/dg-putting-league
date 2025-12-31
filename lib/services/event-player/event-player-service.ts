import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  NotFoundError,
  BadRequestError,
} from '@/lib/errors';
import { requireEventAdmin, getEventWithPlayers } from '@/lib/services/event';
import { EventPlayer } from '@/lib/types/player';
import * as eventPlayerRepo from '@/lib/repositories/event-player-repository';

/**
 * Add a player to an event
 */
export async function addPlayerToEvent(eventId: string, playerId: string) {
  const { supabase } = await requireEventAdmin(eventId);

  // Check event status - players can only be added when event is in pre-bracket status
  const event = await getEventWithPlayers(eventId);
  if (event.status !== 'pre-bracket') {
    throw new BadRequestError('Players can only be added to events in pre-bracket status');
  }

  // Check if the player is already in the event
  const existingPlayer = await eventPlayerRepo.getEventPlayerByPlayerAndEvent(
    supabase,
    eventId,
    playerId
  );

  if (existingPlayer) {
    throw new BadRequestError('Player is already in this event');
  }

  // Insert player
  const insertedId = await eventPlayerRepo.insertEventPlayer(supabase, eventId, playerId);

  // Fetch the inserted row with nested player info for client state updates
  return eventPlayerRepo.getEventPlayer(supabase, insertedId);
}

/**
 * Remove a player from an event
 */
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

  await eventPlayerRepo.deleteEventPlayer(supabase, eventId, eventPlayerId);

  return { success: true };
}

/**
 * Update player payment status
 */
export async function updatePlayerPayment(eventId: string, playerId: string, hasPaid: boolean) {
  const { supabase } = await requireEventAdmin(eventId);

  const result = await eventPlayerRepo.updateEventPlayerPayment(supabase, eventId, playerId, hasPaid);

  if (!result) {
    throw new NotFoundError('Player not found in this event');
  }

  return result;
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
    event.players.map(async (eventPlayer) => {
      let score: number;
      let scoringMethod: 'qualification' | 'pfa' | 'default';

      if (event.qualification_round_enabled) {
        // Calculate total qualification score
        score = await eventPlayerRepo.getQualificationScore(supabase, eventId, eventPlayer.id);
        scoringMethod = 'qualification';
      } else {
        // Calculate PFA from last 6 months
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        // Get all event_player records for this player (across all events)
        const eventPlayerIds = await eventPlayerRepo.getAllEventPlayerIdsForPlayer(
          supabase,
          eventPlayer.player_id
        );

        const frameResults = await eventPlayerRepo.getFrameResultsForEventPlayers(
          supabase,
          eventPlayerIds,
          sixMonthsAgo
        );

        if (frameResults.length > 0) {
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
        ...eventPlayer,
        score,
        scoringMethod,
        default_pool: eventPlayer.player.default_pool || 'B'
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
  const poolAssignments: { id: string; pool: 'A' | 'B'; pfa_score: number; scoring_method: 'qualification' | 'pfa' | 'default' }[] = [];

  playersWithScores.forEach((player, index) => {
    const pool = index < poolASize ? 'A' : 'B';
    poolAssignments.push({
      id: player.id,
      pool,
      pfa_score: player.score,
      scoring_method: player.scoringMethod
    });
  });

  // Update all player pool assignments
  const updates = poolAssignments.map(({ id, pool, pfa_score, scoring_method }) => {
    return eventPlayerRepo.updateEventPlayerPool(supabase, id, pool, pfa_score, scoring_method);
  });

  await Promise.all(updates);

  // Return updated players with pool assignments
  const finalPlayers = await eventPlayerRepo.getEventPlayersWithPools(supabase, eventId);

  return finalPlayers as unknown as EventPlayer[];
}
