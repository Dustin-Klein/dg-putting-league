import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { requireEventAdmin } from '@/lib/services/event';
import * as laneRepo from '@/lib/repositories/lane-repository';
import { getBracketStage, fetchBracketStructure } from '@/lib/repositories/bracket-repository';
import { BadRequestError } from '@/lib/errors';
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
 * Internal function to auto-assign lanes using atomic RPC calls
 * Shared between admin and public versions
 */
async function autoAssignLanesInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<number> {
  // Check event is still in bracket status before attempting lane assignments
  const eventStatus = await laneRepo.getEventStatus(supabase, eventId);

  if (!eventStatus || eventStatus !== 'bracket') {
    // Event is no longer in bracket play - skip lane assignment
    return 0;
  }

  // Get available lanes (idle status)
  const availableLanes = await laneRepo.getAvailableLanes(supabase, eventId);

  if (availableLanes.length === 0) {
    return 0;
  }

  // Get bracket stage
  const stage = await getBracketStage(supabase, eventId);

  if (!stage) {
    return 0;
  }

  // Get unassigned ready/waiting matches in play order
  const unassignedMatches = await laneRepo.getUnassignedReadyMatches(supabase, stage.id);

  if (unassignedMatches.length === 0) {
    return 0;
  }

  // Prepare assignments for bulk operation
  const maxAssignments = Math.min(availableLanes.length, unassignedMatches.length);

  if (maxAssignments === 0) {
    return 0;
  }

  const assignments: Array<{ laneId: string; matchId: number }> = [];
  for (let i = 0; i < maxAssignments; i++) {
    assignments.push({
      laneId: availableLanes[i].id,
      matchId: unassignedMatches[i].id,
    });
  }

  // Bulk assign lanes to matches (1 query instead of N)
  return laneRepo.bulkAssignLanesToMatches(supabase, eventId, assignments);
}

/**
 * Auto-assign available lanes to ready/waiting matches in play order
 * Returns the number of matches that were successfully assigned lanes
 */
export async function autoAssignLanes(eventId: string): Promise<number> {
  const { supabase } = await requireEventAdmin(eventId);
  return autoAssignLanesInternal(supabase, eventId);
}

/**
 * Release lane from a specific match and trigger auto-assignment
 */
export async function releaseMatchLaneAndReassign(
  eventId: string,
  matchId: number
): Promise<number> {
  const { supabase } = await requireEventAdmin(eventId);

  // Release the lane using atomic RPC
  await laneRepo.releaseMatchLane(supabase, eventId, matchId);

  // Auto-assign lanes to next ready matches
  return autoAssignLanesInternal(supabase, eventId);
}

/**
 * Release lane from a specific match and trigger auto-assignment (public version)
 * This version uses the regular supabase client for public scoring flow
 */
export async function releaseAndReassignLanePublic(
  eventId: string,
  matchId: number
): Promise<number> {
  const supabase = await createClient();

  // Release the lane using atomic RPC (works with public client)
  await laneRepo.releaseMatchLane(supabase, eventId, matchId);

  // Auto-assign lanes to next ready matches
  return autoAssignLanesInternal(supabase, eventId);
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
  const { supabase, user } = await requireEventAdmin(eventId);
  const result = await laneRepo.releaseMatchLane(supabase, eventId, matchId, laneId);

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

/**
 * Set a lane to maintenance status (removes from rotation)
 */
export async function setLaneMaintenance(
  eventId: string,
  laneId: string
): Promise<Lane> {
  const { supabase } = await requireEventAdmin(eventId);

  // Use atomic RPC for maintenance mode
  await laneRepo.setLaneMaintenanceRPC(supabase, eventId, laneId);

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
  const { supabase } = await requireEventAdmin(eventId);

  // Use atomic RPC for idle mode
  await laneRepo.setLaneIdleRPC(supabase, eventId, laneId);

  // Fetch and return the updated lane
  return laneRepo.getLaneById(supabase, eventId, laneId);
}
