import 'server-only';
import type { PrivilegedClient } from '@/lib/supabase/types';
import type { Match } from 'brackets-model';
import { Status } from 'brackets-model';
import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';

// ============================================================================
// Standalone bracket data access functions
// ============================================================================

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
 * Uses two parallel queries to avoid PostgREST 3-level nesting timeout issues
 */
export async function getMatchForScoringById(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bracketMatchId: number
): Promise<SingleBracketMatchForScoring | null> {
  const [matchWithFrames, frameResultsResponse] = await Promise.all([
    supabase
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
          is_overtime
        )
      `)
      .eq('id', bracketMatchId)
      .order('frame_number', { foreignTable: 'frames', ascending: true })
      .maybeSingle(),
    supabase.rpc('get_frame_results_for_match', { p_bracket_match_id: bracketMatchId }),
  ]);

  if (matchWithFrames.error) {
    throw new InternalError(`Failed to fetch bracket match: ${matchWithFrames.error.message}`);
  }

  if (frameResultsResponse.error) {
    throw new InternalError(`Failed to fetch frame results: ${frameResultsResponse.error.message}`);
  }

  if (!matchWithFrames.data) {
    return null;
  }

  const resultsByFrameId = new Map<string, Array<{
    id: string;
    event_player_id: string;
    putts_made: number;
    points_earned: number;
  }>>();

  for (const result of frameResultsResponse.data) {
    const frameId = result.match_frame_id;
    if (!resultsByFrameId.has(frameId)) {
      resultsByFrameId.set(frameId, []);
    }
    resultsByFrameId.get(frameId)!.push({
      id: result.id,
      event_player_id: result.event_player_id,
      putts_made: result.putts_made,
      points_earned: result.points_earned,
    });
  }

  const framesWithResults = matchWithFrames.data.frames.map((frame) => ({
    ...frame,
    results: resultsByFrameId.get(frame.id) ?? [],
  }));

  return {
    ...matchWithFrames.data,
    frames: framesWithResults,
  } as SingleBracketMatchForScoring;
}

/**
 * Update bracket match status
 */
export async function updateMatchStatus(
  supabase: PrivilegedClient,
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
  const { data, error } = await supabase
    .from('bracket_stage')
    .select('id')
    .eq('tournament_id', eventId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to check bracket stage: ${error.message}`);
  }

  return !!data;
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
    .maybeSingle();

  if (error) {
    throw new InternalError(`Error fetching bracket stage: ${error.message}`);
  }

  return stage;
}

/**
 * Fetch complete bracket structure (stage, groups, rounds, matches, participants)
 */
export async function fetchBracketStructure(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
) {
  // Get bracket stage first
  const { data: stage, error: stageError } = await supabase
    .from('bracket_stage')
    .select('*')
    .eq('tournament_id', eventId)
    .maybeSingle();

  if (stageError) {
    throw new InternalError(`Error fetching bracket stage: ${stageError.message}`);
  }

  if (!stage) {
    return null;
  }

  // Get other bracket data in parallel
  const [groupsResult, roundsResult, matchesResult, participantsResult] = await Promise.all([
    supabase
      .from('bracket_group')
      .select('*')
      .eq('stage_id', stage.id)
      .order('number'),
    supabase
      .from('bracket_round')
      .select('*')
      .eq('stage_id', stage.id)
      .order('group_id')
      .order('number'),
    supabase
      .from('bracket_match')
      .select('*')
      .eq('stage_id', stage.id)
      .order('round_id')
      .order('number'),
    supabase
      .from('bracket_participant')
      .select('*')
      .eq('tournament_id', eventId)
      .order('id'),
  ]);

  if (groupsResult.error) throw new InternalError(`Error fetching bracket groups: ${groupsResult.error.message}`);
  if (roundsResult.error) throw new InternalError(`Error fetching bracket rounds: ${roundsResult.error.message}`);
  if (matchesResult.error) throw new InternalError(`Error fetching bracket matches: ${matchesResult.error.message}`);
  if (participantsResult.error) throw new InternalError(`Error fetching bracket participants: ${participantsResult.error.message}`);

  return {
    stage,
    groups: groupsResult.data || [],
    rounds: roundsResult.data || [],
    matches: matchesResult.data || [],
    participants: participantsResult.data || [],
  };
}

export interface MatchByIdAndEvent {
  id: number;
  status: number;
  event_id: string;
  lane_id: number | null;
  opponent1: { id: number | null } | null;
  opponent2: { id: number | null } | null;
}

/**
 * Get a bracket match by ID and event ID for validation
 */
export async function getMatchByIdAndEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: number,
  eventId: string
): Promise<MatchByIdAndEvent | null> {
  const { data: match, error } = await supabase
    .from('bracket_match')
    .select('id, status, event_id, lane_id, opponent1, opponent2')
    .eq('id', matchId)
    .eq('event_id', eventId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new InternalError(`Failed to fetch bracket match: ${error.message}`);
  }

  return match as MatchByIdAndEvent;
}

/**
 * Get bracket participants with their team IDs for an event
 */
export async function getParticipantsWithTeamIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<Array<{ id: number; team_id: string | null }>> {
  const { data: participants, error } = await supabase
    .from('bracket_participant')
    .select('id, team_id')
    .eq('tournament_id', eventId);

  if (error) {
    throw new InternalError(`Failed to fetch participants: ${error.message}`);
  }

  return (participants || []) as Array<{ id: number; team_id: string | null }>;
}

/**
 * Get ready matches (status=Ready) for a stage
 */
export async function getReadyMatchesByStageId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: number
): Promise<Match[]> {
  const { data: matches, error } = await supabase
    .from('bracket_match')
    .select('*')
    .eq('stage_id', stageId)
    .eq('status', Status.Ready)
    .order('round_id')
    .order('number');

  if (error) {
    throw new InternalError(`Failed to fetch ready matches: ${error.message}`);
  }

  return (matches || []) as unknown as Match[];
}

export interface BracketMatchForReset {
  id: number;
  stage_id?: number;
  number: number;
  status: number;
  round_id: number;
  group_id: number;
  opponent1: { id?: number | null; position?: number; score?: number; result?: string } | null;
  opponent2: { id?: number | null; position?: number; score?: number; result?: string } | null;
}

export interface BracketResetContextStage {
  id: number;
  type: string;
  settings: { skipFirstRound?: boolean } | null;
}

export interface BracketResetContextGroup {
  id: number;
  number: number;
}

export interface BracketResetContextRound {
  id: number;
  group_id: number;
  number: number;
}

export interface BracketResetContextMatch extends BracketMatchForReset {
  stage_id: number;
}

export interface BracketResetContext {
  stage: BracketResetContextStage;
  groups: BracketResetContextGroup[];
  rounds: BracketResetContextRound[];
  matches: BracketResetContextMatch[];
}

/**
 * Get all bracket matches for an event (for reset cascade computation)
 */
export async function getAllMatchesForEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<BracketMatchForReset[]> {
  const { data: matches, error } = await supabase
    .from('bracket_match')
    .select('id, stage_id, number, status, round_id, group_id, opponent1, opponent2')
    .eq('event_id', eventId);

  if (error) {
    throw new InternalError(`Failed to fetch matches for event: ${error.message}`);
  }

  return (matches || []) as BracketMatchForReset[];
}

/**
 * Get frame counts for a list of match IDs
 */
export async function getFrameCountsForMatchIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchIds: number[]
): Promise<Record<number, number>> {
  if (matchIds.length === 0) return {};

  const { data, error } = await supabase.rpc('get_frame_counts_for_matches', {
    p_match_ids: matchIds,
  });

  if (error) {
    throw new InternalError(`Failed to fetch frame counts: ${error.message}`);
  }

  const counts: Record<number, number> = {};
  for (const row of data ?? []) {
    counts[row.bracket_match_id as number] = Number(row.frame_count);
  }
  return counts;
}

