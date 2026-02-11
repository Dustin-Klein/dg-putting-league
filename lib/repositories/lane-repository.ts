import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';
import { Status } from 'brackets-model';
import type { Lane } from '@/lib/types/bracket';

/**
 * Check if lanes exist for an event
 */
export async function getLanesForEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<Lane[]> {
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
 * Check if lanes already exist for an event (quick check)
 */
export async function hasLanes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<boolean> {
  const { data: existingLanes, error } = await supabase
    .from('lanes')
    .select('id')
    .eq('event_id', eventId)
    .limit(1);

  if (error) {
    throw new InternalError(`Failed to check lanes: ${error.message}`);
  }

  return (existingLanes?.length ?? 0) > 0;
}

/**
 * Insert lanes for an event
 */
export async function insertLanes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  laneCount: number
): Promise<Lane[]> {
  const lanesToInsert = Array.from({ length: laneCount }, (_, i) => ({
    event_id: eventId,
    label: `Lane ${i + 1}`,
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
 * Get matches with lane assignments for an event
 */
export async function getMatchLaneAssignments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<Record<string, { id: number; number: number }>> {
  const { data: matches, error } = await supabase
    .from('bracket_match')
    .select('id, number, lane_id')
    .eq('event_id', eventId)
    .not('lane_id', 'is', null);

  if (error) {
    throw new InternalError(`Failed to fetch match assignments: ${error.message}`);
  }

  const laneMatchMap: Record<string, { id: number; number: number }> = {};
  matches?.forEach((match) => {
    if (match.lane_id) {
      laneMatchMap[match.lane_id] = { id: match.id, number: match.number };
    }
  });

  return laneMatchMap;
}

/**
 * Get available (idle) lanes for an event
 */
export async function getAvailableLanes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<Lane[]> {
  const { data: availableLanes, error } = await supabase
    .from('lanes')
    .select('*')
    .eq('event_id', eventId)
    .eq('status', 'idle')
    .order('label');

  if (error) {
    throw new InternalError(`Failed to fetch available lanes: ${error.message}`);
  }

  return (availableLanes || []) as Lane[];
}

/**
 * Get unassigned ready/waiting matches in play order
 */
export async function getUnassignedReadyMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: number
): Promise<{ id: number; round_id: number; group_id: number; number: number; status: number }[]> {
  const [matchResult, roundResult] = await Promise.all([
    supabase
      .from('bracket_match')
      .select('id, round_id, group_id, number, status, updated_at, opponent1, opponent2')
      .eq('stage_id', stageId)
      .in('status', [Status.Ready, Status.Waiting])
      .is('lane_id', null),
    supabase
      .from('bracket_round')
      .select('id, number')
      .eq('stage_id', stageId),
  ]);

  if (matchResult.error) {
    throw new InternalError(`Failed to fetch unassigned matches: ${matchResult.error.message}`);
  }
  if (roundResult.error) {
    throw new InternalError(`Failed to fetch rounds: ${roundResult.error.message}`);
  }

  const roundNumber = new Map(
    (roundResult.data || []).map((r) => [r.id, r.number] as const)
  );

  const rawMatches = (matchResult.data || []) as {
    id: number; round_id: number; group_id: number; number: number; status: number; updated_at: string;
    opponent1: { id?: number | null } | null;
    opponent2: { id?: number | null } | null;
  }[];

  // Filter out matches where neither opponent has a team assigned
  const matches = rawMatches.filter((m) => {
    const hasOpp1 = m.opponent1?.id != null;
    const hasOpp2 = m.opponent2?.id != null;
    return hasOpp1 && hasOpp2;
  });

  matches.sort((a, b) => {
    const aRound = roundNumber.get(a.round_id) ?? 0;
    const bRound = roundNumber.get(b.round_id) ?? 0;
    // Lower rounds first
    if (aRound !== bRound) return aRound - bRound;
    // Ready (2) before Waiting (1) within same round
    if (b.status !== a.status) return b.status - a.status;
    // Longest-waiting first within same status
    const aUpdated = new Date(a.updated_at).getTime();
    const bUpdated = new Date(b.updated_at).getTime();
    if (aUpdated !== bUpdated) return aUpdated - bUpdated;
    // Match number within round
    if (a.number !== b.number) return a.number - b.number;
    // Tiebreaker
    return a.id - b.id;
  });

  return matches;
}

/**
 * Get event status
 */
export async function getEventStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<string | null> {
  const { data: event, error } = await supabase
    .from('events')
    .select('status')
    .eq('id', eventId)
    .single();

  if (error || !event) {
    return null;
  }

  return event.status;
}

/**
 * Assign lane to match using atomic RPC
 */
export async function assignLaneToMatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  laneId: string,
  matchId: number
): Promise<boolean> {
  const { data: assigned, error } = await supabase
    .rpc('assign_lane_to_match', {
      p_event_id: eventId,
      p_lane_id: laneId,
      p_match_id: matchId,
    });

  if (error) {
    console.error(`RPC error assigning lane ${laneId} to match ${matchId}:`, error);
    return false;
  }

  return assigned === true;
}

/**
 * Release lane from a match using atomic RPC
 */
export async function releaseMatchLane(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  matchId: number,
  laneId?: string
): Promise<boolean> {
  const { data: released, error } = await supabase
    .rpc('release_match_lane', {
      p_event_id: eventId,
      p_lane_id: laneId ?? null,
      p_match_id: matchId,
    });

  if (error) {
    console.error(`RPC error releasing lane from match ${matchId}:`, error);
    return false;
  }

  return released === true;
}

/**
 * Set lane to maintenance using atomic RPC
 */
export async function setLaneMaintenanceRPC(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  laneId: string
): Promise<void> {
  const { error } = await supabase
    .rpc('set_lane_maintenance', {
      p_event_id: eventId,
      p_lane_id: laneId,
    });

  if (error) {
    throw new InternalError(`Failed to set lane to maintenance: ${error.message}`);
  }
}

/**
 * Set lane to idle using atomic RPC
 */
export async function setLaneIdleRPC(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  laneId: string
): Promise<void> {
  const { error } = await supabase
    .rpc('set_lane_idle', {
      p_event_id: eventId,
      p_lane_id: laneId,
    });

  if (error) {
    throw new InternalError(`Failed to set lane to idle: ${error.message}`);
  }
}

/**
 * Reset all occupied lanes for an event back to idle
 */
export async function resetAllLanesToIdle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<void> {
  const { error } = await supabase
    .from('lanes')
    .update({ status: 'idle' })
    .eq('event_id', eventId)
    .eq('status', 'occupied');

  if (error) {
    throw new InternalError(`Failed to reset lanes to idle: ${error.message}`);
  }
}

/**
 * Get a single lane by ID
 */
export async function getLaneById(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  laneId: string
): Promise<Lane> {
  const { data: lane, error } = await supabase
    .from('lanes')
    .select()
    .eq('id', laneId)
    .eq('event_id', eventId)
    .single();

  if (error || !lane) {
    throw new InternalError(`Failed to fetch lane: ${error?.message}`);
  }

  return lane as Lane;
}

/**
 * Add lanes to an event, continuing from the highest existing "Lane N" number
 */
export async function addLanesToEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  count: number
): Promise<Lane[]> {
  const existingLanes = await getLanesForEvent(supabase, eventId);

  let maxNumber = 0;
  for (const lane of existingLanes) {
    const match = lane.label.match(/^Lane (\d+)$/);
    if (match) {
      maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
    }
  }

  const lanesToInsert = Array.from({ length: count }, (_, i) => ({
    event_id: eventId,
    label: `Lane ${maxNumber + i + 1}`,
    status: 'idle' as const,
  }));

  const { data: lanes, error } = await supabase
    .from('lanes')
    .insert(lanesToInsert)
    .select();

  if (error) {
    throw new InternalError(`Failed to add lanes: ${error.message}`);
  }

  return (lanes || []) as Lane[];
}

/**
 * Delete a lane only if it is idle
 */
export async function deleteIdleLane(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  laneId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('lanes')
    .delete()
    .eq('id', laneId)
    .eq('event_id', eventId)
    .eq('status', 'idle')
    .select('id');

  if (error) {
    throw new InternalError(`Failed to delete lane: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Get lane labels for an event as a map from lane ID to label
 */
export async function getLaneLabelsForEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<Record<string, string>> {
  const { data: lanes, error } = await supabase
    .from('lanes')
    .select('id, label')
    .eq('event_id', eventId);

  if (error) {
    throw new InternalError(`Failed to fetch lane labels: ${error.message}`);
  }

  const laneMap: Record<string, string> = {};
  lanes?.forEach((lane) => {
    laneMap[lane.id] = lane.label;
  });

  return laneMap;
}

/**
 * Bulk assign lanes to matches using atomic RPC
 * Returns the number of successful assignments
 */
export async function bulkAssignLanesToMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  assignments: Array<{ laneId: string; matchId: number }>
): Promise<number> {
  if (assignments.length === 0) {
    return 0;
  }

  const assignmentsJson = assignments.map(a => ({
    lane_id: a.laneId,
    match_id: a.matchId,
  }));

  const { data: count, error } = await supabase
    .rpc('bulk_assign_lanes_to_matches', {
      p_event_id: eventId,
      p_assignments: assignmentsJson,
    });

  if (error) {
    throw new InternalError(`Failed to bulk assign lanes: ${error.message}`);
  }

  return count ?? 0;
}
