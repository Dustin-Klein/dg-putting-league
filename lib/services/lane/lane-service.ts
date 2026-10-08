import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { requireEventAdmin } from '@/lib/services/event';
import type { Db } from '@/lib/services/auth';
import { lockEvent, withTransaction, type Tx } from '@/lib/db/tx';
import * as laneRepo from '@/lib/repositories/lane-repository';
import * as laneDb from '@/lib/repositories/lane-repository.db';
import { fetchBracketStructure } from '@/lib/repositories/bracket-repository';
import { getStageForEvent } from '@/lib/repositories/bracket-repository.db';
import { getEventBracketConfig } from '@/lib/repositories/event-repository.db';
import { BadRequestError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/utils/logger';
import { Status } from 'brackets-model';
import type { Lane, LaneWithMatch } from '@/lib/types/bracket';

export type { Lane, LaneWithMatch } from '@/lib/types/bracket';

/**
 * Create lanes for an event based on lane_count
 */
export async function createEventLanes(
  eventId: string,
  laneCount: number
): Promise<Lane[]> {
  const { supabase } = await requireEventAdmin(eventId);

  // Check if lanes already exist for this event
  const hasExistingLanes = await laneRepo.hasLanes(supabase, eventId);

  if (hasExistingLanes) {
    // Lanes already exist, return them
    return laneRepo.getLanesForEvent(supabase, eventId);
  }

  // Create new lanes
  return laneRepo.insertLanes(supabase, eventId, laneCount);
}

/**
 * Get all lanes for an event
 */
export async function getEventLanes(eventId: string): Promise<Lane[]> {
  const supabase = await createClient();
  return laneRepo.getLanesForEvent(supabase, eventId);
}

interface BracketMatch {
  id: number;
  round_id: number;
  number: number;
  status: number;
  opponent1: unknown;
  opponent2: unknown;
}

/**
 * Checks if a match is a bye (hidden in bracket view).
 * Mirrors the client-side isByeMatch logic in bracket-view.tsx.
 */
function isByeMatch(match: BracketMatch): boolean {
  if (match.opponent1 === null || match.opponent2 === null) {
    return true;
  }
  if (match.status === Status.Archived) {
    const opp1 = match.opponent1 as { score?: number } | null;
    const opp2 = match.opponent2 as { score?: number } | null;
    if (opp1?.score === undefined && opp2?.score === undefined) {
      return true;
    }
  }
  return false;
}

/**
 * Build a bidirectional map between match database IDs and display numbers.
 * Mirrors the sequential numbering in bracket-view.tsx.
 */
async function buildMatchDisplayMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<{ idToDisplay: Map<number, number>; displayToId: Map<number, number> }> {
  const idToDisplay = new Map<number, number>();
  const displayToId = new Map<number, number>();

  const bracket = await fetchBracketStructure(supabase, eventId);
  if (!bracket) return { idToDisplay, displayToId };

  const { groups, rounds, matches } = bracket;

  let displayNumber = 1;
  for (const group of groups) {
    const groupRounds = rounds
      .filter((r: { group_id: number }) => r.group_id === group.id)
      .sort((a: { number: number }, b: { number: number }) => a.number - b.number);

    for (const round of groupRounds) {
      const roundMatches = (matches as BracketMatch[])
        .filter((m) => m.round_id === round.id)
        .sort((a, b) => a.number - b.number);

      for (const match of roundMatches) {
        if (!isByeMatch(match)) {
          idToDisplay.set(match.id, displayNumber);
          displayToId.set(displayNumber, match.id);
          displayNumber++;
        }
      }
    }
  }

  return { idToDisplay, displayToId };
}

/**
 * Resolve a bracket display number (e.g. 18 for "M18") to a database match ID
 */
export async function resolveMatchDisplayNumber(
  eventId: string,
  displayNumber: number
): Promise<number | null> {
  const supabase = await createClient();
  const { displayToId } = await buildMatchDisplayMap(supabase, eventId);
  return displayToId.get(displayNumber) ?? null;
}

/**
 * Get lanes with their current match assignments
 */
export async function getLanesWithMatches(
  eventId: string
): Promise<LaneWithMatch[]> {
  const supabase = await createClient();

  const [lanes, laneMatchMap, { idToDisplay }] = await Promise.all([
    laneRepo.getLanesForEvent(supabase, eventId),
    laneRepo.getMatchLaneAssignments(supabase, eventId),
    buildMatchDisplayMap(supabase, eventId),
  ]);

  return lanes.map((lane) => {
    const match = laneMatchMap[lane.id] || null;
    return {
      ...lane,
      current_match_id: match?.id ?? null,
      current_match_number: match ? (idToDisplay.get(match.id) ?? null) : null,
    };
  });
}

/**
 * Put idle lanes on unassigned Ready/Waiting matches, in play order. Runs inside the
 * caller's transaction, which must hold the event lock. Returns the number assigned.
 */
export async function autoAssignLanesTx(tx: Tx, eventId: string): Promise<number> {
  const event = await getEventBracketConfig(tx, eventId, { lock: 'share' });
  if (event?.status !== 'bracket') {
    // Event is no longer in bracket play - skip lane assignment
    return 0;
  }

  const stage = await getStageForEvent(tx, eventId);
  if (!stage) {
    return 0;
  }

  const idleLanes = (await laneDb.lockEventLanes(tx, eventId))
    .filter((lane) => lane.status === 'idle')
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  if (idleLanes.length === 0) {
    return 0;
  }

  const matches = await laneDb.getUnassignedReadyMatches(tx, stage.id);

  let assigned = 0;
  for (let i = 0; i < Math.min(idleLanes.length, matches.length); i++) {
    if (await laneDb.assignLane(tx, eventId, idleLanes[i].id, matches[i].id)) {
      assigned++;
    }
  }
  return assigned;
}

/**
 * Release a match's lane and give the free lanes to the next matches, inside the
 * caller's transaction (which must hold the event lock).
 */
export async function releaseLaneAndAutoAssignTx(tx: Tx, eventId: string, matchId: number): Promise<number> {
  await laneDb.releaseMatchLane(tx, eventId, matchId);
  return autoAssignLanesTx(tx, eventId);
}

/**
 * Auto-assign available lanes to ready/waiting matches in play order
 * Returns the number of matches that were successfully assigned lanes
 */
export async function autoAssignLanes(eventId: string): Promise<number> {
  const { pg } = await requireEventAdmin(eventId);
  return withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    return autoAssignLanesTx(tx, eventId);
  });
}

/**
 * Add lanes to an event
 */
export async function addLanes(
  eventId: string,
  count: number
): Promise<Lane[]> {
  const { supabase, user } = await requireEventAdmin(eventId);

  if (count < 1 || count > 20) {
    throw new BadRequestError('Lane count must be between 1 and 20');
  }

  const lanes = await laneRepo.addLanesToEvent(supabase, eventId, count);

  logger.info('Lanes added to event', {
    userId: user.id,
    action: 'add_lanes',
    eventId,
    count,
    outcome: 'success',
  });

  return lanes;
}

/**
 * Delete an idle lane from an event
 */
export async function deleteLane(
  eventId: string,
  laneId: string
): Promise<boolean> {
  const { supabase, user } = await requireEventAdmin(eventId);
  const result = await laneRepo.deleteIdleLane(supabase, eventId, laneId);

  logger.info('Lane deleted from event', {
    userId: user.id,
    action: 'delete_lane',
    eventId,
    laneId,
    outcome: 'success',
  });

  return result;
}

/**
 * Release a lane from a match without triggering auto-reassign
 */
export async function releaseLane(
  eventId: string,
  laneId: string,
  matchId: number
): Promise<boolean> {
  const { pg, user } = await requireEventAdmin(eventId);
  const result = await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    await laneDb.lockEventLanes(tx, eventId);
    return laneDb.releaseMatchLane(tx, eventId, matchId, laneId);
  });

  logger.info('Lane released from match', {
    userId: user.id,
    action: 'release_lane',
    eventId,
    laneId,
    matchId,
    outcome: 'success',
  });

  return result;
}

async function setLaneStatus(
  pg: Db,
  eventId: string,
  laneId: string,
  status: 'idle' | 'maintenance'
): Promise<void> {
  const found = await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    await laneDb.lockEventLanes(tx, eventId);
    return laneDb.setLaneStatusAndClearMatch(tx, eventId, laneId, status);
  });
  if (!found) {
    throw new NotFoundError('Lane not found');
  }
}

/**
 * Set a lane to maintenance status (removes from rotation)
 */
export async function setLaneMaintenance(
  eventId: string,
  laneId: string
): Promise<Lane> {
  const { supabase, pg } = await requireEventAdmin(eventId);

  await setLaneStatus(pg, eventId, laneId, 'maintenance');

  // Fetch and return the updated lane
  return laneRepo.getLaneById(supabase, eventId, laneId);
}

/**
 * Set a lane back to idle (returns to rotation)
 */
export async function setLaneIdle(
  eventId: string,
  laneId: string
): Promise<Lane> {
  const { supabase, pg } = await requireEventAdmin(eventId);

  await setLaneStatus(pg, eventId, laneId, 'idle');

  // Fetch and return the updated lane
  return laneRepo.getLaneById(supabase, eventId, laneId);
}
