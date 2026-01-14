import 'server-only';
import { requireEventAdmin } from '@/lib/services/event';
import { releaseMatchLaneAndReassign } from '@/lib/services/lane';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '@/lib/errors';
import { completeMatch } from './match-completion';
import { calculatePoints } from './points-calculator';
import { getTeamFromParticipant } from '@/lib/repositories/team-repository';
import { getOrCreateFrame as getOrCreateFrameRepo } from '@/lib/repositories/frame-repository';
import type {
  BracketMatchWithDetails,
  OpponentData,
  MatchFrame,
  FrameResult,
  RecordFrameResultInput,
} from '@/lib/types/scoring';

export type {
  BracketMatchWithDetails,
  OpponentData,
  TeamWithPlayers,
  PlayerInTeam,
  MatchFrame,
  FrameResult,
  RecordFrameResultInput,
} from '@/lib/types/scoring';

export { calculatePoints } from './points-calculator';

/**
 * Record a score for a player in a frame (admin-authenticated)
 */
export async function recordScoreAdmin(
  eventId: string,
  bracketMatchId: number,
  frameNumber: number,
  eventPlayerId: string,
  puttsMade: number
): Promise<BracketMatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  if (puttsMade < 0 || puttsMade > 3) {
    throw new BadRequestError('Putts must be between 0 and 3');
  }

  const [eventRes, bracketMatchRes] = await Promise.all([
    supabase.from('events').select('bonus_point_enabled').eq('id', eventId).single(),
    supabase.from('bracket_match').select('id, status').eq('id', bracketMatchId).eq('event_id', eventId).single(),
  ]);

  const { data: event, error: eventError } = eventRes;
  if (eventError || !event) {
    throw new NotFoundError('Event not found');
  }

  const { data: bracketMatch, error: matchError } = bracketMatchRes;
  if (matchError || !bracketMatch) {
    throw new NotFoundError('Bracket match not found');
  }

  if (bracketMatch.status === 4) { // Completed
    throw new BadRequestError('Match is already completed');
  }

  const pointsEarned = calculatePoints(puttsMade, event.bonus_point_enabled);
  const isOvertime = frameNumber > 5;
  const frame = await getOrCreateFrameRepo(supabase, bracketMatchId, frameNumber, isOvertime);

  // Atomically upsert the frame result with correct order_in_frame
  // This RPC handles the race condition where concurrent requests could
  // both read the same max order and assign duplicate order values
  const { error: upsertError } = await supabase.rpc('upsert_frame_result_atomic', {
    p_match_frame_id: frame.id,
    p_event_player_id: eventPlayerId,
    p_bracket_match_id: bracketMatchId,
    p_putts_made: puttsMade,
    p_points_earned: pointsEarned,
  });

  if (upsertError) {
    throw new InternalError(`Failed to record score: ${upsertError.message}`);
  }

  if (bracketMatch.status === 2) { // Ready status
    await supabase
      .from('bracket_match')
      .update({ status: 3 }) // Running status
      .eq('id', bracketMatchId);
  }

  return getBracketMatchWithDetails(eventId, bracketMatchId);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const { data: frame, error: frameError } = await supabase
    .from('match_frames')
    .select('id, bracket_match_id, bracket_match:bracket_match(event_id)')
    .eq('id', matchFrameId)
    .single();

  if (frameError) {
    throw new InternalError(`Failed to fetch frame: ${frameError.message}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!frame || (frame.bracket_match as any)?.event_id !== eventId) {
    throw new NotFoundError('Frame not found');
  }

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

  const frame = await getOrCreateFrame(eventId, bracketMatchId, frameNumber, isOvertime);

  for (const result of results) {
    await recordFrameResult(eventId, frame.id, result);
  }

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

  const match = await getBracketMatchWithDetails(eventId, bracketMatchId);
  const score1 = match.opponent1?.score ?? 0;
  const score2 = match.opponent2?.score ?? 0;

  await completeMatch(supabase, eventId, bracketMatchId, {
    team1Score: score1,
    team2Score: score2,
  });

  try {
    await releaseMatchLaneAndReassign(eventId, bracketMatchId);
  } catch (laneError) {
    console.error('Failed to release lane and reassign:', laneError);
  }

  return getBracketMatchWithDetails(eventId, bracketMatchId);
}

/**
 * Complete a bracket match with final scores (no frame data)
 * This sets the scores, completes the match, and handles lane reassignment
 */
export async function completeMatchWithFinalScores(
  eventId: string,
  bracketMatchId: number,
  team1Score: number,
  team2Score: number
): Promise<BracketMatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  if (team1Score === team2Score) {
    throw new BadRequestError('Scores cannot be tied - there must be a winner');
  }

  await completeMatch(supabase, eventId, bracketMatchId, {
    team1Score,
    team2Score,
  });

  try {
    await releaseMatchLaneAndReassign(eventId, bracketMatchId);
  } catch (laneError) {
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
    .update({ status: 3 }) // Running status
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
