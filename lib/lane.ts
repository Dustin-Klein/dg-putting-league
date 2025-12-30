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
  const { data: matches } = await supabase
    .from('bracket_match')
    .select('id, lane_id')
    .eq('event_id', eventId)
    .not('lane_id', 'is', null);

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
 * Auto-assign available lanes to ready/waiting matches in play order
 * Lanes are assigned to Ready and Waiting matches so players know where to go.
 * Ready matches are prioritized over Waiting matches.
 * The match status is NOT changed to Running - that happens when scoring begins.
 * Returns the number of matches that were assigned lanes
 */
export async function autoAssignLanes(eventId: string): Promise<number> {
  const { supabase } = await requireEventAdmin(eventId);

  // Get available lanes (idle status) - use authenticated client
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

  // Get unassigned ready/waiting matches in play order - use authenticated client
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

  // Assign lanes to matches
  const assignmentCount = Math.min(availableLanes.length, unassignedMatches.length);

  for (let i = 0; i < assignmentCount; i++) {
    const lane = availableLanes[i];
    const match = unassignedMatches[i];

    // Update match with lane (keep current status)
    const { error: matchError } = await supabase
      .from('bracket_match')
      .update({
        lane_id: lane.id,
      })
      .eq('id', match.id);

    if (matchError) {
      console.error(`Failed to assign lane ${lane.id} to match ${match.id}:`, matchError);
      continue;
    }

    // Update lane status to occupied
    const { error: laneError } = await supabase
      .from('lanes')
      .update({ status: 'occupied' })
      .eq('id', lane.id);

    if (laneError) {
      console.error(`Failed to update lane status for ${lane.id}:`, laneError);
    }
  }

  return assignmentCount;
}

/**
 * Release a lane from a completed match and set it back to idle
 * @param eventId - The event ID
 * @param laneId - The lane ID to release
 */
export async function releaseLane(
  eventId: string,
  laneId: string
): Promise<void> {
  const { supabase } = await requireEventAdmin(eventId);

  // Verify lane belongs to event
  const { data: lane } = await supabase
    .from('lanes')
    .select('id')
    .eq('id', laneId)
    .eq('event_id', eventId)
    .single();

  if (!lane) {
    throw new NotFoundError('Lane not found');
  }

  // Clear lane_id from any matches using this lane
  const { error: clearError } = await supabase
    .from('bracket_match')
    .update({ lane_id: null })
    .eq('lane_id', laneId)
    .eq('event_id', eventId);

  if (clearError) {
    console.error('Failed to clear lane_id from matches:', clearError);
    throw new InternalError(`Failed to clear lane from matches: ${clearError.message}`);
  }

  // Set lane status to idle
  const { error } = await supabase
    .from('lanes')
    .update({ status: 'idle' })
    .eq('id', laneId);

  if (error) {
    throw new InternalError(`Failed to release lane: ${error.message}`);
  }
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

  // Get the match's lane
  const { data: match } = await supabase
    .from('bracket_match')
    .select('lane_id')
    .eq('id', matchId)
    .eq('event_id', eventId)
    .single();

  if (!match?.lane_id) {
    // No lane to release, just try to auto-assign any available lanes
    return autoAssignLanes(eventId);
  }

  // Release the lane
  await releaseLane(eventId, match.lane_id);

  // Auto-assign lanes to next ready matches
  return autoAssignLanes(eventId);
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

  // Get the match's lane
  const { data: match } = await supabase
    .from('bracket_match')
    .select('lane_id')
    .eq('id', matchId)
    .eq('event_id', eventId)
    .single();

  if (!match?.lane_id) {
    // No lane to release, just try to auto-assign any available lanes
    return autoAssignLanesPublic(eventId);
  }

  const laneId = match.lane_id;

  // Clear lane_id from the completed match
  const { error: clearError } = await supabase
    .from('bracket_match')
    .update({ lane_id: null })
    .eq('lane_id', laneId)
    .eq('event_id', eventId);

  if (clearError) {
    console.error('Failed to clear lane_id from match:', clearError);
  }

  // Set lane status to idle
  const { error: laneError } = await supabase
    .from('lanes')
    .update({ status: 'idle' })
    .eq('id', laneId);

  if (laneError) {
    console.error('Failed to set lane to idle:', laneError);
  }

  // Auto-assign lanes to next ready matches
  return autoAssignLanesPublic(eventId);
}

/**
 * Auto-assign available lanes to ready/waiting matches (public version)
 * This version uses the regular supabase client for public scoring flow
 * Ready matches are prioritized over Waiting matches.
 */
async function autoAssignLanesPublic(eventId: string): Promise<number> {
  const supabase = await createClient();

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

  // Assign lanes to matches
  const assignmentCount = Math.min(availableLanes.length, unassignedMatches.length);

  for (let i = 0; i < assignmentCount; i++) {
    const lane = availableLanes[i];
    const match = unassignedMatches[i];

    // Update match with lane (keep current status)
    const { error: matchError } = await supabase
      .from('bracket_match')
      .update({
        lane_id: lane.id,
      })
      .eq('id', match.id);

    if (matchError) {
      console.error(`Failed to assign lane ${lane.id} to match ${match.id}:`, matchError);
      continue;
    }

    // Update lane status to occupied
    const { error: laneError } = await supabase
      .from('lanes')
      .update({ status: 'occupied' })
      .eq('id', lane.id);

    if (laneError) {
      console.error(`Failed to update lane status for ${lane.id}:`, laneError);
    }
  }

  return assignmentCount;
}

/**
 * Set a lane to maintenance status (removes from rotation)
 */
export async function setLaneMaintenance(
  eventId: string,
  laneId: string
): Promise<Lane> {
  const { supabase } = await requireEventAdmin(eventId);

  // First release any match using this lane
  await supabase
    .from('bracket_match')
    .update({ lane_id: null })
    .eq('lane_id', laneId)
    .eq('event_id', eventId);

  // Set lane to maintenance
  const { data: lane, error } = await supabase
    .from('lanes')
    .update({ status: 'maintenance' })
    .eq('id', laneId)
    .eq('event_id', eventId)
    .select()
    .single();

  if (error || !lane) {
    throw new InternalError(`Failed to set lane to maintenance: ${error?.message}`);
  }

  return lane as Lane;
}

/**
 * Set a lane back to idle (returns to rotation)
 */
export async function setLaneIdle(
  eventId: string,
  laneId: string
): Promise<Lane> {
  const { supabase } = await requireEventAdmin(eventId);

  const { data: lane, error } = await supabase
    .from('lanes')
    .update({ status: 'idle' })
    .eq('id', laneId)
    .eq('event_id', eventId)
    .select()
    .single();

  if (error || !lane) {
    throw new InternalError(`Failed to set lane to idle: ${error?.message}`);
  }

  return lane as Lane;
}
