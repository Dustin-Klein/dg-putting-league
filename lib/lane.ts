import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { requireEventAdmin } from '@/lib/event';
import { InternalError, NotFoundError } from '@/lib/errors';
import { Status } from 'brackets-model';

export interface Lane {
  id: string;
  event_id: string;
  label: string;
  status: 'idle' | 'occupied' | 'maintenance';
}

export interface LaneWithMatch extends Lane {
  current_match_id: number | null;
}

/**
 * Create lanes for an event based on lane_count
 * @param eventId - The event ID
 * @param laneCount - Number of lanes to create
 */
export async function createEventLanes(
  eventId: string,
  laneCount: number
): Promise<Lane[]> {
  const { supabase } = await requireEventAdmin(eventId);

  // Check if lanes already exist for this event
  const { data: existingLanes } = await supabase
    .from('lanes')
    .select('id')
    .eq('event_id', eventId)
    .limit(1);

  if (existingLanes && existingLanes.length > 0) {
    // Lanes already exist, return them
    const { data: lanes } = await supabase
      .from('lanes')
      .select('*')
      .eq('event_id', eventId)
      .order('label');

    return (lanes || []) as Lane[];
  }

  // Create new lanes
  const lanesToInsert = Array.from({ length: laneCount }, (_, i) => ({
    event_id: eventId,
    label: `${i + 1}`,
    status: 'idle' as const,
  }));

  const { data: lanes, error } = await supabase
    .from('lanes')
    .insert(lanesToInsert)
    .select();

  if (error) {
    throw new InternalError(`Failed to create lanes: ${error.message}`);
  }

  return (lanes || []) as Lane[];
}

/**
 * Get all lanes for an event
 */
export async function getEventLanes(eventId: string): Promise<Lane[]> {
  const supabase = await createClient();

  const { data: lanes, error } = await supabase
    .from('lanes')
    .select('*')
    .eq('event_id', eventId)
    .order('label');

  if (error) {
    throw new InternalError(`Failed to fetch lanes: ${error.message}`);
  }

  return (lanes || []) as Lane[];
}

/**
 * Get lanes with their current match assignments
 */
export async function getLanesWithMatches(
  eventId: string
): Promise<LaneWithMatch[]> {
  const supabase = await createClient();

  // Get lanes
  const { data: lanes, error: lanesError } = await supabase
    .from('lanes')
    .select('*')
    .eq('event_id', eventId)
    .order('label');

  if (lanesError) {
    throw new InternalError(`Failed to fetch lanes: ${lanesError.message}`);
  }

  // Get matches with lane assignments
  const { data: matches, error: matchesError } = await supabase
    .from('bracket_match')
    .select('id, lane_id')
    .eq('event_id', eventId)
    .not('lane_id', 'is', null);

  if (matchesError) {
    throw new InternalError(`Failed to fetch match assignments: ${matchesError.message}`);
  }

  // Create a map of lane_id to match_id
  const laneMatchMap: Record<string, number> = {};
  matches?.forEach((match) => {
    if (match.lane_id) {
      laneMatchMap[match.lane_id] = match.id;
    }
  });

  return (lanes || []).map((lane) => ({
    ...lane,
    current_match_id: laneMatchMap[lane.id] || null,
  })) as LaneWithMatch[];
}

/**
 * Internal function to auto-assign lanes using atomic RPC calls
 * Shared between admin and public versions
 */
async function autoAssignLanesInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<number> {
  // Get available lanes (idle status)
  const { data: availableLanes, error: lanesError } = await supabase
    .from('lanes')
    .select('*')
    .eq('event_id', eventId)
    .eq('status', 'idle')
    .order('label');

  if (lanesError) {
    console.error('Failed to fetch available lanes:', lanesError);
    return 0;
  }

  if (!availableLanes || availableLanes.length === 0) {
    return 0;
  }

  // Get bracket stage
  const { data: stage } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .single();

  if (!stage) {
    return 0;
  }

  // Get unassigned ready/waiting matches in play order
  // Order by status DESC so Ready (2) comes before Waiting (1)
  const { data: unassignedMatches, error: matchesError } = await supabase
    .from('bracket_match')
    .select('id, round_id, group_id, number, status')
    .eq('stage_id', stage.id)
    .in('status', [Status.Ready, Status.Waiting])
    .is('lane_id', null)
    .order('status', { ascending: false }) // Ready (2) before Waiting (1)
    .order('round_id', { ascending: true })
    .order('group_id', { ascending: true })
    .order('number', { ascending: true });

  if (matchesError) {
    console.error('Failed to fetch unassigned matches:', matchesError);
    return 0;
  }

  if (!unassignedMatches || unassignedMatches.length === 0) {
    return 0;
  }

  // Assign lanes to matches using atomic RPC
  const maxAssignments = Math.min(availableLanes.length, unassignedMatches.length);
  let successfulAssignments = 0;

  for (let i = 0; i < maxAssignments; i++) {
    const lane = availableLanes[i];
    const match = unassignedMatches[i];

    // Use atomic RPC for lane assignment
    const { data: assigned, error: rpcError } = await supabase
      .rpc('assign_lane_to_match', {
        p_event_id: eventId,
        p_lane_id: lane.id,
        p_match_id: match.id,
      });

    if (rpcError) {
      console.error(`RPC error assigning lane ${lane.id} to match ${match.id}:`, rpcError);
      continue;
    }

    if (assigned) {
      successfulAssignments++;
    }
  }

  return successfulAssignments;
}

/**
 * Auto-assign available lanes to ready/waiting matches in play order
 * Lanes are assigned to Ready and Waiting matches so players know where to go.
 * Ready matches are prioritized over Waiting matches.
 * The match status is NOT changed to Running - that happens when scoring begins.
 * Returns the number of matches that were successfully assigned lanes
 */
export async function autoAssignLanes(eventId: string): Promise<number> {
  const { supabase } = await requireEventAdmin(eventId);
  return autoAssignLanesInternal(supabase, eventId);
}

/**
 * Internal function to release a lane from a specific match using atomic RPC
 */
async function releaseMatchLaneInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  matchId: number
): Promise<boolean> {
  const { data: released, error } = await supabase
    .rpc('release_match_lane', {
      p_event_id: eventId,
      p_match_id: matchId,
    });

  if (error) {
    console.error(`RPC error releasing lane from match ${matchId}:`, error);
    return false;
  }

  return released === true;
}

/**
 * Release lane from a specific match and trigger auto-assignment
 * @param eventId - The event ID
 * @param matchId - The bracket match ID
 */
export async function releaseMatchLaneAndReassign(
  eventId: string,
  matchId: number
): Promise<number> {
  const { supabase } = await requireEventAdmin(eventId);

  // Release the lane using atomic RPC
  await releaseMatchLaneInternal(supabase, eventId, matchId);

  // Auto-assign lanes to next ready matches
  return autoAssignLanesInternal(supabase, eventId);
}

/**
 * Release lane from a specific match and trigger auto-assignment (public version)
 * This version uses the regular supabase client for public scoring flow
 * @param eventId - The event ID
 * @param matchId - The bracket match ID
 */
export async function releaseAndReassignLanePublic(
  eventId: string,
  matchId: number
): Promise<number> {
  const supabase = await createClient();

  // Release the lane using atomic RPC (works with public client)
  await releaseMatchLaneInternal(supabase, eventId, matchId);

  // Auto-assign lanes to next ready matches
  return autoAssignLanesInternal(supabase, eventId);
}

/**
 * Set a lane to maintenance status (removes from rotation)
 * Uses atomic RPC to ensure consistency
 */
export async function setLaneMaintenance(
  eventId: string,
  laneId: string
): Promise<Lane> {
  const { supabase } = await requireEventAdmin(eventId);

  // Use atomic RPC for maintenance mode
  const { error: rpcError } = await supabase
    .rpc('set_lane_maintenance', {
      p_event_id: eventId,
      p_lane_id: laneId,
    });

  if (rpcError) {
    throw new InternalError(`Failed to set lane to maintenance: ${rpcError.message}`);
  }

  // Fetch and return the updated lane
  const { data: lane, error } = await supabase
    .from('lanes')
    .select()
    .eq('id', laneId)
    .eq('event_id', eventId)
    .single();

  if (error || !lane) {
    throw new InternalError(`Failed to fetch lane after maintenance: ${error?.message}`);
  }

  return lane as Lane;
}

/**
 * Set a lane back to idle (returns to rotation)
 * Uses atomic RPC to ensure consistency
 */
export async function setLaneIdle(
  eventId: string,
  laneId: string
): Promise<Lane> {
  const { supabase } = await requireEventAdmin(eventId);

  // Use atomic RPC for idle mode
  const { error: rpcError } = await supabase
    .rpc('set_lane_idle', {
      p_event_id: eventId,
      p_lane_id: laneId,
    });

  if (rpcError) {
    throw new InternalError(`Failed to set lane to idle: ${rpcError.message}`);
  }

  // Fetch and return the updated lane
  const { data: lane, error } = await supabase
    .from('lanes')
    .select()
    .eq('id', laneId)
    .eq('event_id', eventId)
    .single();

  if (error || !lane) {
    throw new InternalError(`Failed to fetch lane after setting idle: ${error?.message}`);
  }

  return lane as Lane;
}
