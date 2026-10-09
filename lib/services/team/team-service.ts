import 'server-only';
import {
  BadRequestError,
} from '@/lib/errors';
import { requireEventAdmin, getEventWithPlayers } from '@/lib/services/event';
import type { Team } from '@/lib/types/team';
import type { EventPlayer } from '@/lib/types/player';
import type { PoolAssignment } from '@/lib/services/event-player';
import * as teamRepo from '@/lib/repositories/team-repository.db';
import * as eventPlayerRepo from '@/lib/repositories/event-player-repository.db';
import { lockEvent, withTransaction } from '@/lib/db/tx';
import { getEventBracketConfig } from '@/lib/repositories/event-repository.db';

// Re-export types for consumers
export type { Team, TeamMember } from '@/lib/types/team';

/**
 * Team member data structure for atomic transition
 */
export interface TeamMemberPairing {
  eventPlayerId: string;
  role: 'A_pool' | 'B_pool';
}

/**
 * Team pairing data structure for atomic transition
 */
export interface TeamPairing {
  seed: number;
  poolCombo: string;
  combinedScore: number;
  members: TeamMemberPairing[];
}

/**
 * Generate a cryptographically secure random integer in [0, maxExclusive)
 * using rejection sampling to eliminate modulo bias.
 */
export function cryptoRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) {
    return 0;
  }

  // Find the largest multiple of maxExclusive that fits in a 32-bit unsigned integer (2^32 = 4294967296)
  const range = 0x100000000; // 2^32
  const limit = range - (range % maxExclusive);
  const buffer = new Uint32Array(1);

  while (true) {
    crypto.getRandomValues(buffer);
    const value = buffer[0];
    if (value < limit) {
      return value % maxExclusive;
    }
  }
}

/**
 * Fisher-Yates shuffle on a copy of the input array.
 */
export function shuffle<T>(
  array: readonly T[],
  randomInt: (maxExclusive: number) => number = cryptoRandomInt
): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

/**
 * Generate teams of 2 players (1 from Pool A, 1 from Pool B) when event status changes to 'bracket'
 */
export async function generateTeams(eventId: string): Promise<Team[]> {
  const { supabase, pg } = await requireEventAdmin(eventId);
  const event = await getEventWithPlayers(eventId);

  // Allow team generation for events transitioning to bracket status (pre-bracket)
  // or already in bracket status
  if (event.status !== 'pre-bracket' && event.status !== 'bracket') {
    throw new BadRequestError('Teams can only be generated for events in pre-bracket or bracket status');
  }

  // Check if teams already exist
  const existingTeams = await teamRepo.getTeamsForEvent(pg, eventId);
  if (existingTeams.length > 0) {
    throw new BadRequestError('Teams have already been generated for this event');
  }

  // Get players with their pools and qualification scores
  const playersWithPools = event.players.filter(player => player.pool);
  if (playersWithPools.length === 0) {
    throw new BadRequestError('No players have been assigned to pools');
  }

  // Separate players by pool
  const poolAPlayers = playersWithPools.filter(player => player.pool === 'A');
  const poolBPlayers = playersWithPools.filter(player => player.pool === 'B');

  if (poolAPlayers.length === 0 || poolBPlayers.length === 0) {
    throw new BadRequestError('Both Pool A and Pool B must have players to generate teams');
  }

  // Calculate qualification scores for seeding
  const playersWithScores = await Promise.all(
    playersWithPools.map(async (player) => {
      let score: number;

      if (event.qualification_round_enabled) {
        // Calculate total qualification score
        score = await eventPlayerRepo.getQualificationScore(pg, eventId, player.id);
      } else {
        // For events without qualification, use 0 as base score (seeding will be random within pools)
        score = 0;
      }

      return {
        ...player,
        qualificationScore: score
      };
    })
  );

  // Shuffle players in each pool for random pairing
  const shuffledPoolA = shuffle(poolAPlayers);
  const shuffledPoolB = shuffle(poolBPlayers);

  // Generate teams by randomly pairing Pool A with Pool B players
  const teamsToCreate: { poolAPlayer: EventPlayer; poolBPlayer: EventPlayer }[] = [];
  const minPoolSize = Math.min(shuffledPoolA.length, shuffledPoolB.length);

  for (let i = 0; i < minPoolSize; i++) {
    teamsToCreate.push({
      poolAPlayer: shuffledPoolA[i],
      poolBPlayer: shuffledPoolB[i],
    });
  }

  const scoreByPlayer = new Map(playersWithScores.map((player) => [player.id, player.qualificationScore]));

  return withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    await getEventBracketConfig(tx, eventId, { lock: 'share' });
    if ((await teamRepo.getTeamsForEvent(tx, eventId)).length > 0) {
      throw new BadRequestError('Teams have already been generated for this event');
    }

    const inserted = await teamRepo.insertTeamsWithMembers(
      tx,
      eventId,
      teamsToCreate.map((team, index) => ({
        seed: index + 1,
        pool_combo: `${team.poolAPlayer.player.full_name} & ${team.poolBPlayer.player.full_name}`,
        members: [
          { event_player_id: team.poolAPlayer.id, role: 'A_pool' },
          { event_player_id: team.poolBPlayer.id, role: 'B_pool' },
        ],
      }))
    );

    const ranked = inserted.map((team, index) => ({
      id: team.id,
      combinedScore:
        (scoreByPlayer.get(teamsToCreate[index].poolAPlayer.id) ?? 0) +
        (scoreByPlayer.get(teamsToCreate[index].poolBPlayer.id) ?? 0),
    }));
    ranked.sort((a, b) => b.combinedScore - a.combinedScore);
    for (const [index, team] of ranked.entries()) {
      await teamRepo.updateTeamSeed(tx, team.id, index + 1);
    }

    return teamRepo.getFullTeamsForEvent(tx, eventId);
  });
}

/**
 * Get teams for an event
 */
export async function getEventTeams(eventId: string): Promise<Team[]> {
  const { pg } = await requireEventAdmin(eventId);
  const teams = await teamRepo.getFullTeamsForEvent(pg, eventId);
  return teams as unknown as Team[];
}

/**
 * Compute team pairings based on pool assignments without persisting.
 * This is used by the atomic transition RPC to pre-compute the data.
 *
 * Randomly pairs Pool A players with Pool B players.
 * Returns teams sorted by combined score (highest first) with seeds assigned.
 */
export function computeTeamPairings(
  poolAssignments: PoolAssignment[],
  randomInt?: (maxExclusive: number) => number
): TeamPairing[] {
  // Separate players by pool
  const poolAPlayers = poolAssignments.filter(pa => pa.pool === 'A');
  const poolBPlayers = poolAssignments.filter(pa => pa.pool === 'B');

  if (poolAPlayers.length === 0 || poolBPlayers.length === 0) {
    throw new BadRequestError('Both Pool A and Pool B must have players to generate teams');
  }

  // Shuffle players in each pool for random pairing
  const shuffledPoolA = shuffle(poolAPlayers, randomInt);
  const shuffledPoolB = shuffle(poolBPlayers, randomInt);

  // Generate teams by randomly pairing Pool A with Pool B players
  const minPoolSize = Math.min(shuffledPoolA.length, shuffledPoolB.length);
  const teams: TeamPairing[] = [];

  for (let i = 0; i < minPoolSize; i++) {
    const poolAPlayer = shuffledPoolA[i];
    const poolBPlayer = shuffledPoolB[i];
    const combinedScore = poolAPlayer.pfaScore + poolBPlayer.pfaScore;
    const poolCombo = `${poolAPlayer.playerName} & ${poolBPlayer.playerName}`;

    teams.push({
      seed: 0, // Will be assigned after sorting by combined score
      poolCombo,
      combinedScore,
      members: [
        { eventPlayerId: poolAPlayer.eventPlayerId, role: 'A_pool' },
        { eventPlayerId: poolBPlayer.eventPlayerId, role: 'B_pool' },
      ],
    });
  }

  // Sort teams by combined score (descending) and assign seeds
  teams.sort((a, b) => b.combinedScore - a.combinedScore);
  teams.forEach((team, index) => {
    team.seed = index + 1;
  });

  return teams;
}
