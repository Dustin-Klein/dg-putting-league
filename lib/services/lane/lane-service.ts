import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { requireEventAdmin } from '@/lib/services/event';
import * as laneRepo from '@/lib/repositories/lane-repository';
import { getBracketStage } from '@/lib/repositories/bracket-repository';
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

/**
 * Get lanes with their current match assignments
 */
export async function getLanesWithMatches(
  eventId: string
): Promise<LaneWithMatch[]> {
  const supabase = await createClient();

  // Get lanes
  const lanes = await laneRepo.getLanesForEvent(supabase, eventId);

  // Get match assignments
  const laneMatchMap = await laneRepo.getMatchLaneAssignments(supabase, eventId);

  return lanes.map((lane) => ({
    ...lane,
    current_match_id: laneMatchMap[lane.id] || null,
  }));
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
