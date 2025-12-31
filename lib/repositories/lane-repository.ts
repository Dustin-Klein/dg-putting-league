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
): Promise<Record<string, number>> {
  const { data: matches, error } = await supabase
    .from('bracket_match')
    .select('id, lane_id')
    .eq('event_id', eventId)
    .not('lane_id', 'is', null);

  if (error) {
    throw new InternalError(`Failed to fetch match assignments: ${error.message}`);
  }

  const laneMatchMap: Record<string, number> = {};
  matches?.forEach((match) => {
    if (match.lane_id) {
      laneMatchMap[match.lane_id] = match.id;
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
 * Get bracket stage for an event
 */
export async function getBracketStage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<{ id: number } | null> {
  const { data: stage, error } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .single();

  if (error) {
    return null;
  }

  return stage;
}

/**
 * Get unassigned ready/waiting matches in play order
 */
export async function getUnassignedReadyMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: number
): Promise<{ id: number; round_id: number; group_id: number; number: number; status: number }[]> {
  const { data: unassignedMatches, error } = await supabase
    .from('bracket_match')
    .select('id, round_id, group_id, number, status')
    .eq('stage_id', stageId)
    .in('status', [Status.Ready, Status.Waiting])
    .is('lane_id', null)
    .order('status', { ascending: false }) // Ready (2) before Waiting (1)
    .order('round_id', { ascending: true })
    .order('group_id', { ascending: true })
    .order('number', { ascending: true });

  if (error) {
    throw new InternalError(`Failed to fetch unassigned matches: ${error.message}`);
  }

  return (unassignedMatches || []);
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
