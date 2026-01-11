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

export interface BracketMatchForScoring {
  id: number;
  status: number;
  round_id: number;
  number: number;
  lane_id: string | null;
  opponent1: { id?: number; score?: number } | null;
  opponent2: { id?: number; score?: number } | null;
  frames: Array<{
    id: string;
    frame_number: number;
    is_overtime: boolean;
    results: Array<{
      id: string;
      event_player_id: string;
      putts_made: number;
      points_earned: number;
    }>;
  }>;
}

/**
 * Get bracket matches for scoring by event (status = Ready or Running, with lane assigned)
 */
export async function getMatchesForScoringByEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<BracketMatchForScoring[]> {
  const { data: bracketMatches, error } = await supabase
    .from('bracket_match')
    .select(`
      id,
      status,
      round_id,
      number,
      lane_id,
      opponent1,
      opponent2,
      frames:match_frames(
        id,
        frame_number,
        is_overtime,
        results:frame_results(
          id,
          event_player_id,
          putts_made,
          points_earned
        )
      )
    `)
    .eq('event_id', eventId)
    .in('status', [2, 3]) // Ready = 2, Running = 3
    .not('lane_id', 'is', null);

  if (error) {
    throw new InternalError(`Failed to fetch matches for scoring: ${error.message}`);
  }

  return (bracketMatches || []) as unknown as BracketMatchForScoring[];
}

export interface SingleBracketMatchForScoring extends BracketMatchForScoring {
  event_id: string;
}

/**
 * Get a single bracket match for scoring by ID
 */
export async function getMatchForScoringById(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bracketMatchId: number
): Promise<SingleBracketMatchForScoring | null> {
  const { data: bracketMatch, error } = await supabase
    .from('bracket_match')
    .select(`
      id,
      status,
      round_id,
      number,
      lane_id,
      opponent1,
      opponent2,
      event_id,
      frames:match_frames(
        id,
        frame_number,
        is_overtime,
        results:frame_results(
          id,
          event_player_id,
          putts_made,
          points_earned
        )
      )
    `)
    .eq('id', bracketMatchId)
    .single();

  if (error || !bracketMatch) {
    return null;
  }

  return bracketMatch as unknown as SingleBracketMatchForScoring;
}

/**
 * Update bracket match status
 */
export async function updateMatchStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: number,
  status: number
): Promise<void> {
  const { error } = await supabase
    .from('bracket_match')
    .update({ status })
    .eq('id', matchId);

  if (error) {
    throw new InternalError(`Failed to update match status: ${error.message}`);
  }
}

/**
 * Check if bracket stage exists for an event
 */
export async function bracketStageExists(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .maybeSingle();

  return !!data;
}

/**
 * Link participants to teams in batch
 */
export async function linkParticipantsToTeams(
  supabase: Awaited<ReturnType<typeof createClient>>,
  mappings: Array<{ participantId: number; teamId: string }>
): Promise<void> {
  for (const mapping of mappings) {
    const { error } = await supabase
      .from('bracket_participant')
      .update({ team_id: mapping.teamId })
      .eq('id', mapping.participantId);

    if (error) {
      throw new InternalError(`Failed to link participant to team: ${error.message}`);
    }
  }
}

/**
 * Get bracket participants for an event
 */
export async function getBracketParticipants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<Array<{ id: number; tournament_id: string; name: string | null; team_id: string | null }>> {
  const { data: participants, error } = await supabase
    .from('bracket_participant')
    .select('*')
    .eq('tournament_id', eventId)
    .order('id');

  if (error) {
    throw new InternalError(`Failed to fetch bracket participants: ${error.message}`);
  }

  return (participants || []) as Array<{ id: number; tournament_id: string; name: string | null; team_id: string | null }>;
}

/**
 * Update all bracket matches with event_id for a given stage
 */
export async function setEventIdOnMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: number,
  eventId: string
): Promise<void> {
  const { error } = await supabase
    .from('bracket_match')
    .update({ event_id: eventId })
    .eq('stage_id', stageId);

  if (error) {
    throw new InternalError(`Failed to set event_id on matches: ${error.message}`);
  }
}

/**
 * Get all matches for a stage
 */
export async function getMatchesByStageId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: number
): Promise<Array<{ id: number; opponent1: unknown; opponent2: unknown; status: number }>> {
  const { data: matches, error } = await supabase
    .from('bracket_match')
    .select('*')
    .eq('stage_id', stageId)
    .not('opponent1', 'is', null)
    .not('opponent2', 'is', null);

  if (error) {
    throw new InternalError(`Failed to fetch matches: ${error.message}`);
  }

  return (matches || []) as Array<{ id: number; opponent1: unknown; opponent2: unknown; status: number }>;
}
