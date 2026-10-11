import 'server-only';
import {
  BadRequestError,
} from '@/lib/errors';
import { requireEventAdmin } from '@/lib/services/event';
import type { Team } from '@/lib/types/team';
import type { PoolAssignment } from '@/lib/services/event-player';
import { buildTeamPairing, seedTeams, type TeamPairing } from './composition';
import * as teamRepo from '@/lib/repositories/team-repository.db';

// Re-export types for consumers
export type { Team, TeamMember } from '@/lib/types/team';
export * from './composition';

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
 * Get teams for an event
 */
export async function getEventTeams(eventId: string): Promise<Team[]> {
  const { pg } = await requireEventAdmin(eventId);
  return teamRepo.getFullTeamsForEvent(pg, eventId);
}

/**
 * Compute team pairings based on pool assignments without persisting.
 * This is used by the atomic transition RPC to pre-compute the data.
 *
 * Randomly pairs Pool A players (slot 1) with Pool B players (slot 2).
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
    teams.push(buildTeamPairing([shuffledPoolA[i], shuffledPoolB[i]]));
  }

  return seedTeams(teams);
}
