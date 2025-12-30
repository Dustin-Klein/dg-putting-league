import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { requireEventAdmin } from '@/lib/services/event';
import { releaseMatchLaneAndReassign } from '@/lib/services/lane';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '@/lib/errors';
import { completeMatch } from './match-completion';
import { getTeamFromParticipant } from '@/lib/repositories/team-repository';

// Re-export calculatePoints for backwards compatibility
export { calculatePoints } from './points-calculator';

export interface BracketMatchWithDetails {
  id: number;
  event_id: string;
  stage_id: number;
  group_id: number;
  round_id: number;
  number: number;
  status: number;
  lane_id: string | null;
  opponent1: OpponentData | null;
  opponent2: OpponentData | null;
  team_one?: TeamWithPlayers;
  team_two?: TeamWithPlayers;
  frames?: MatchFrame[];
}

export interface OpponentData {
  id: number | null;
  score?: number;
  result?: 'win' | 'loss' | 'draw';
}

export interface TeamWithPlayers {
  id: string;
  seed: number;
  pool_combo: string;
  players: PlayerInTeam[];
}

export interface PlayerInTeam {
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
  player: {
    id: string;
    full_name: string;
    nickname: string | null;
  };
}

export interface MatchFrame {
  id: string;
  bracket_match_id: number;
  frame_number: number;
  is_overtime: boolean;
  results: FrameResult[];
}

export interface FrameResult {
  id: string;
  match_frame_id: string;
  event_player_id: string;
  bracket_match_id?: number | null;
  putts_made: number;
  points_earned: number;
  order_in_frame: number;
}

export interface RecordFrameResultInput {
  event_player_id: string;
  putts_made: number;
  points_earned: number;
  order_in_frame: number;
}


/**
 * Get bracket match with full details including teams and frames
 */
export async function getBracketMatchWithDetails(
  eventId: string,
  bracketMatchId: number
): Promise<BracketMatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  const { data: bracketMatch, error } = await supabase
    .from('bracket_match')
    .select(`
      *,
      frames:match_frames(
        id,
        bracket_match_id,
        frame_number,
        is_overtime,
        results:frame_results(
          id,
          match_frame_id,
          event_player_id,
          putts_made,
          points_earned,
          order_in_frame
        )
      )
    `)
    .eq('id', bracketMatchId)
    .eq('event_id', eventId)
    .single();

  if (error || !bracketMatch) {
    throw new NotFoundError('Bracket match not found');
  }

  // Get teams from participants
  const opponent1 = bracketMatch.opponent1 as OpponentData | null;
  const opponent2 = bracketMatch.opponent2 as OpponentData | null;

  const [team_one, team_two] = await Promise.all([
    getTeamFromParticipant(supabase, opponent1?.id ?? null),
    getTeamFromParticipant(supabase, opponent2?.id ?? null),
  ]);

  return {
    ...bracketMatch,
    opponent1,
    opponent2,
    team_one,
    team_two,
    frames: bracketMatch.frames?.sort((a: any, b: any) => a.frame_number - b.frame_number) || [],
  } as BracketMatchWithDetails;
}

/**
 * Create or get a frame for a bracket match
 */
export async function getOrCreateFrame(
  eventId: string,
  bracketMatchId: number,
  frameNumber: number,
  isOvertime = false
): Promise<MatchFrame> {
  const { supabase } = await requireEventAdmin(eventId);

  // Verify bracket match belongs to event
  const { data: bracketMatch, error: matchError } = await supabase
    .from('bracket_match')
    .select('id, event_id')
    .eq('id', bracketMatchId)
    .eq('event_id', eventId)
    .single();

  if (matchError) {
    throw new InternalError(`Failed to fetch bracket match: ${matchError.message}`);
  }
  if (!bracketMatch) {
    throw new NotFoundError('Bracket match not found');
  }

  // Try to find existing frame
  const { data: existingFrame, error: frameQueryError } = await supabase
    .from('match_frames')
    .select(`
      *,
      results:frame_results(*)
    `)
    .eq('bracket_match_id', bracketMatchId)
    .eq('frame_number', frameNumber)
    .maybeSingle();

  if (frameQueryError) {
    throw new InternalError(`Failed to query frame: ${frameQueryError.message}`);
  }
  if (existingFrame) {
    return existingFrame as MatchFrame;
  }

  // Create new frame
  const { data: newFrame, error } = await supabase
    .from('match_frames')
    .insert({
      bracket_match_id: bracketMatchId,
      frame_number: frameNumber,
      is_overtime: isOvertime,
    })
    .select(`
      *,
      results:frame_results(*)
    `)
    .single();

  if (error || !newFrame) {
    throw new InternalError(`Failed to create frame: ${error?.message}`);
  }

  return newFrame as MatchFrame;
}

/**
 * Record a player's result for a frame
 */
export async function recordFrameResult(
  eventId: string,
  matchFrameId: string,
  input: RecordFrameResultInput
): Promise<FrameResult> {
  const { supabase } = await requireEventAdmin(eventId);

  // Verify frame belongs to a bracket match in this event
  const { data: frame, error: frameError } = await supabase
    .from('match_frames')
    .select('id, bracket_match_id, bracket_match:bracket_match(event_id)')
    .eq('id', matchFrameId)
    .single();

  if (frameError) {
    throw new InternalError(`Failed to fetch frame: ${frameError.message}`);
  }
  if (!frame || (frame.bracket_match as any)?.event_id !== eventId) {
    throw new NotFoundError('Frame not found');
  }

  // Validate putts and points
  if (input.putts_made < 0 || input.putts_made > 3) {
    throw new BadRequestError('Putts made must be between 0 and 3');
  }
  if (input.points_earned < 0 || input.points_earned > 4) {
    throw new BadRequestError('Points earned must be between 0 and 4');
  }

  // Upsert the frame result (includes denormalized bracket_match_id for robust cascade delete handling)
  const { data: result, error } = await supabase
    .from('frame_results')
    .upsert(
      {
        match_frame_id: matchFrameId,
        event_player_id: input.event_player_id,
        bracket_match_id: frame.bracket_match_id,
        putts_made: input.putts_made,
        points_earned: input.points_earned,
        order_in_frame: input.order_in_frame,
      },
      {
        onConflict: 'match_frame_id,event_player_id',
      }
    )
    .select()
    .single();

  if (error || !result) {
    throw new InternalError(`Failed to record frame result: ${error?.message}`);
  }

  return result as FrameResult;
}

/**
 * Record multiple frame results at once (for a full frame)
 */
export async function recordFullFrame(
  eventId: string,
  bracketMatchId: number,
  frameNumber: number,
  results: RecordFrameResultInput[],
  isOvertime = false
): Promise<MatchFrame> {
  const { supabase } = await requireEventAdmin(eventId);

  // Get or create the frame
  const frame = await getOrCreateFrame(eventId, bracketMatchId, frameNumber, isOvertime);

  // Record all results
  for (const result of results) {
    await recordFrameResult(eventId, frame.id, result);
  }

  // Fetch updated frame with results
  const { data: updatedFrame, error } = await supabase
    .from('match_frames')
    .select(`
      *,
      results:frame_results(*)
    `)
    .eq('id', frame.id)
    .single();

  if (error || !updatedFrame) {
    throw new InternalError('Failed to fetch updated frame');
  }

  return updatedFrame as MatchFrame;
}

/**
 * Complete a bracket match and update bracket progression
 */
export async function completeBracketMatch(
  eventId: string,
  bracketMatchId: number
): Promise<BracketMatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  // Get match with current scores
  const match = await getBracketMatchWithDetails(eventId, bracketMatchId);

  const score1 = match.opponent1?.score ?? 0;
  const score2 = match.opponent2?.score ?? 0;

  // Use shared match completion logic
  await completeMatch(supabase, eventId, bracketMatchId, {
    team1Score: score1,
    team2Score: score2,
  });

  // Release the lane and auto-assign to next ready match
  // This runs after completeMatch() which may have set new matches to Ready
  try {
    await releaseMatchLaneAndReassign(eventId, bracketMatchId);
  } catch (laneError) {
    // Log but don't fail - lane management is secondary to match completion
    console.error('Failed to release lane and reassign:', laneError);
  }

  return getBracketMatchWithDetails(eventId, bracketMatchId);
}

/**
 * Start a bracket match (set status to in_progress/Running)
 */
export async function startBracketMatch(
  eventId: string,
  bracketMatchId: number
): Promise<BracketMatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  // Verify bracket match belongs to event
  const { data: bracketMatch, error: matchError } = await supabase
    .from('bracket_match')
    .select('id')
    .eq('id', bracketMatchId)
    .eq('event_id', eventId)
    .single();

  if (matchError) {
    throw new InternalError(`Failed to fetch bracket match: ${matchError.message}`);
  }
  if (!bracketMatch) {
    throw new NotFoundError('Bracket match not found');
  }

  const { error } = await supabase
    .from('bracket_match')
    .update({ status: 3 }) // Running
    .eq('id', bracketMatchId);

  if (error) {
    throw new InternalError(`Failed to start match: ${error.message}`);
  }

  return getBracketMatchWithDetails(eventId, bracketMatchId);
}

// Legacy aliases for backwards compatibility during migration
// These can be removed once all callers are updated
export const getMatchWithDetails = getBracketMatchWithDetails;
export { completeBracketMatch as completeMatchAdmin };
export const startMatch = startBracketMatch;
export type MatchWithDetails = BracketMatchWithDetails;
