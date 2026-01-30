import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  NotFoundError,
  BadRequestError,
} from '@/lib/errors';
import { requireEventAdmin, getEventWithPlayers } from '@/lib/services/event';
import { EventPlayer } from '@/lib/types/player';
import { EventWithDetails } from '@/lib/types/event';
import * as eventPlayerRepo from '@/lib/repositories/event-player-repository';

/**
 * Pool assignment data structure for atomic transition
 */
export interface PoolAssignment {
  eventPlayerId: string;
  playerId: string;
  playerName: string;
  pool: 'A' | 'B';
  pfaScore: number;
  scoringMethod: 'qualification' | 'pfa' | 'default';
  defaultPool: 'A' | 'B';
}

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

  // Separate scored players from default (no history) players
  const scoredPlayers = playersWithScores.filter(p => p.scoringMethod !== 'default');
  const defaultPlayers = playersWithScores.filter(p => p.scoringMethod === 'default');

  // Sort scored players by score descending, with tie-breaking
  scoredPlayers.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.default_pool !== b.default_pool) {
      return a.default_pool === 'A' ? -1 : 1;
    }
    return 0;
  });

  // Place default players directly into their defaultPool
  const defaultACount = defaultPlayers.filter(p => p.default_pool === 'A').length;

  // Calculate how many scored players should go to Pool A
  const totalPlayers = scoredPlayers.length + defaultPlayers.length;
  const poolASize = Math.ceil(totalPlayers / 2);
  const scoredForA = Math.min(
    Math.max(0, poolASize - defaultACount),
    scoredPlayers.length
  );

  const poolAssignments: { id: string; pool: 'A' | 'B'; pfa_score: number; scoring_method: 'qualification' | 'pfa' | 'default' }[] = [];

  // Assign scored players
  scoredPlayers.forEach((player, index) => {
    poolAssignments.push({
      id: player.id,
      pool: index < scoredForA ? 'A' : 'B',
      pfa_score: player.score,
      scoring_method: player.scoringMethod
    });
  });

  // Assign default players to their defaultPool
  defaultPlayers.forEach((player) => {
    poolAssignments.push({
      id: player.id,
      pool: player.default_pool,
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

/**
 * Compute pool assignments for all players in an event without persisting.
 * This is used by the atomic transition RPC to pre-compute the data.
 *
 * Returns an array of pool assignments sorted by score (top half -> Pool A, bottom half -> Pool B)
 */
export async function computePoolAssignments(
  eventId: string,
  event: EventWithDetails
): Promise<PoolAssignment[]> {
  const supabase = await createClient();

  if (!event.players || event.players.length === 0) {
    throw new BadRequestError('No players registered for this event');
  }

  // Check if pools are already assigned
  const playersWithPools = event.players.filter(player => player.pool);
  if (playersWithPools.length > 0) {
    throw new BadRequestError('Players have already been assigned to pools');
  }

  // Calculate scores for each player
  let playersWithScores: Array<{
    eventPlayerId: string;
    playerId: string;
    playerName: string;
    score: number;
    scoringMethod: 'qualification' | 'pfa' | 'default';
    defaultPool: 'A' | 'B';
  }>;

  if (event.qualification_round_enabled) {
    playersWithScores = await Promise.all(
      event.players.map(async (eventPlayer) => {
        const score = await eventPlayerRepo.getQualificationScore(supabase, eventId, eventPlayer.id);
        return {
          eventPlayerId: eventPlayer.id,
          playerId: eventPlayer.player_id,
          playerName: eventPlayer.player.full_name,
          score,
          scoringMethod: 'qualification' as const,
          defaultPool: (eventPlayer.player.default_pool || 'B') as 'A' | 'B',
        };
      })
    );
  } else {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const playerIds = event.players.map(ep => ep.player_id);

    const playerEventPlayerMap = await eventPlayerRepo.getAllEventPlayerIdsForPlayersBulk(
      supabase,
      playerIds
    );

    const pfaScores = await eventPlayerRepo.getPfaScoresBulk(
      supabase,
      playerEventPlayerMap,
      sixMonthsAgo
    );

    playersWithScores = event.players.map((eventPlayer) => {
      const pfaData = pfaScores.get(eventPlayer.player_id);
      let score: number;
      let scoringMethod: 'qualification' | 'pfa' | 'default';

      if (pfaData && pfaData.frameCount > 0) {
        score = pfaData.totalPoints / pfaData.frameCount;
        scoringMethod = 'pfa';
      } else {
        score = 0;
        scoringMethod = 'default';
      }

      return {
        eventPlayerId: eventPlayer.id,
        playerId: eventPlayer.player_id,
        playerName: eventPlayer.player.full_name,
        score,
        scoringMethod,
        defaultPool: (eventPlayer.player.default_pool || 'B') as 'A' | 'B',
      };
    });
  }

  // Separate scored players from default (no history) players
  const scoredPlayers = playersWithScores.filter(p => p.scoringMethod !== 'default');
  const defaultPlayers = playersWithScores.filter(p => p.scoringMethod === 'default');

  // Sort scored players by score descending, with tie-breaking
  scoredPlayers.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.defaultPool !== b.defaultPool) {
      return a.defaultPool === 'A' ? -1 : 1;
    }
    return 0;
  });

  // Place default players directly into their defaultPool
  const defaultACount = defaultPlayers.filter(p => p.defaultPool === 'A').length;

  // Calculate how many scored players should go to Pool A
  const totalPlayers = scoredPlayers.length + defaultPlayers.length;
  const poolASize = Math.ceil(totalPlayers / 2);
  const scoredForA = Math.min(
    Math.max(0, poolASize - defaultACount),
    scoredPlayers.length
  );

  const assignments: PoolAssignment[] = [];

  // Assign scored players
  scoredPlayers.forEach((player, index) => {
    assignments.push({
      eventPlayerId: player.eventPlayerId,
      playerId: player.playerId,
      playerName: player.playerName,
      pool: index < scoredForA ? 'A' : 'B',
      pfaScore: player.score,
      scoringMethod: player.scoringMethod,
      defaultPool: player.defaultPool,
    });
  });

  // Assign default players to their defaultPool
  defaultPlayers.forEach((player) => {
    assignments.push({
      eventPlayerId: player.eventPlayerId,
      playerId: player.playerId,
      playerName: player.playerName,
      pool: player.defaultPool,
      pfaScore: player.score,
      scoringMethod: player.scoringMethod,
      defaultPool: player.defaultPool,
    });
  });

  return assignments;
}
