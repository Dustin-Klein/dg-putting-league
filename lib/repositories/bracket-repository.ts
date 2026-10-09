import 'server-only';
import type { Match } from 'brackets-model';
import { Status } from 'brackets-model';
import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';

// ============================================================================
// Standalone bracket data access functions
// ============================================================================

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
