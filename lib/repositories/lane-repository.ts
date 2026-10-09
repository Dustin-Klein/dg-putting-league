import { createClient } from '@/lib/supabase/server';
import type { PrivilegedClient } from '@/lib/supabase/types';
import { InternalError } from '@/lib/errors';
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
  supabase: PrivilegedClient,
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
  supabase: PrivilegedClient,
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
  supabase: PrivilegedClient,
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

