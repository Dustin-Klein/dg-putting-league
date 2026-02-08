import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  NotFoundError,
  BadRequestError,
} from '@/lib/errors';
import { requireEventAdmin, getEventWithPlayers } from '@/lib/services/event';
import { EventPlayer, PaymentType } from '@/lib/types/player';
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
export async function updatePlayerPayment(eventId: string, playerId: string, paymentType: PaymentType | null) {
  const { supabase } = await requireEventAdmin(eventId);

  const result = await eventPlayerRepo.updateEventPlayerPayment(supabase, eventId, playerId, paymentType);

  if (!result) {
    throw new NotFoundError('Player not found in this event');
  }

  return result;
}

interface PoolInput {
  score: number;
  scoringMethod: 'qualification' | 'pfa' | 'default';
  defaultPool: 'A' | 'B';
}

/**
 * Assigns pools to players based on scores and default pool preferences.
 * Returns assignments in the same order as the input array.
 */
function assignPools(players: PoolInput[]): { pool: 'A' | 'B' }[] {
  const indexed = players.map((p, i) => ({ ...p, originalIndex: i }));

  const scoredPlayers = indexed.filter(p => p.scoringMethod !== 'default');
  const defaultPlayers = indexed.filter(p => p.scoringMethod === 'default');

  scoredPlayers.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.defaultPool !== b.defaultPool) {
      return a.defaultPool === 'A' ? -1 : 1;
    }
    return 0;
  });

  const defaultAPlayers = defaultPlayers.filter(p => p.defaultPool === 'A');
  const defaultBPlayers = defaultPlayers.filter(p => p.defaultPool === 'B');
  const totalPlayers = scoredPlayers.length + defaultPlayers.length;
  const poolASize = Math.ceil(totalPlayers / 2);
  const poolBSize = totalPlayers - poolASize;

  const actualDefaultA = Math.min(defaultAPlayers.length, poolASize);
  const actualDefaultB = Math.min(defaultBPlayers.length, poolBSize);

  const result: { pool: 'A' | 'B' }[] = new Array(players.length);

  // Place default players, capping at pool capacity and overflowing to opposite pool
  defaultAPlayers.forEach((player, index) => {
    result[player.originalIndex] = { pool: index < actualDefaultA ? 'A' : 'B' };
  });
  defaultBPlayers.forEach((player, index) => {
    result[player.originalIndex] = { pool: index < actualDefaultB ? 'B' : 'A' };
  });

  // Fill remaining spots with scored players (highest scores to A)
  const remainingA = poolASize - actualDefaultA - Math.max(0, defaultBPlayers.length - actualDefaultB);
  const scoredForA = Math.min(Math.max(0, remainingA), scoredPlayers.length);

  scoredPlayers.forEach((player, index) => {
    result[player.originalIndex] = { pool: index < scoredForA ? 'A' : 'B' };
  });

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
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 100);

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

  const computed = assignPools(playersWithScores.map(p => ({
    score: p.score,
    scoringMethod: p.scoringMethod,
    defaultPool: p.default_pool,
  })));

  const poolAssignments = playersWithScores.map((player, i) => ({
    id: player.id,
    pool: computed[i].pool,
    pfa_score: player.score,
    scoring_method: player.scoringMethod,
  }));

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

  const computed = assignPools(playersWithScores.map(p => ({
    score: p.score,
    scoringMethod: p.scoringMethod,
    defaultPool: p.defaultPool,
  })));

  const assignments: PoolAssignment[] = playersWithScores.map((player, i) => ({
    eventPlayerId: player.eventPlayerId,
    playerId: player.playerId,
    playerName: player.playerName,
    pool: computed[i].pool,
    pfaScore: player.score,
    scoringMethod: player.scoringMethod,
    defaultPool: player.defaultPool,
  }));

  return assignments.sort((a, b) => {
    if (a.pool !== b.pool) {
      return a.pool === 'A' ? -1 : 1;
    }
    return b.pfaScore - a.pfaScore;
  });
}
