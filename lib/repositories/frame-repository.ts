import { createClient } from '@/lib/supabase/server';
import type { PrivilegedClient } from '@/lib/supabase/types';
import { InternalError } from '@/lib/errors';
import type { MatchFrame, FrameResult } from '@/lib/types/scoring';

// Partial type for queries without results join
export type FrameData = Omit<MatchFrame, 'results'>;

/**
 * Get frame with all results
 */
export async function getMatchFrame(
  supabase: Awaited<ReturnType<typeof createClient>>,
  frameId: string
): Promise<MatchFrame> {
  const { data: frame, error } = await supabase
    .from('match_frames')
    .select(`
      id,
      bracket_match_id,
      frame_number,
      is_overtime,
      results:frame_results(
        id,
        match_frame_id,
        event_player_id,
        bracket_match_id,
        putts_made,
        points_earned,
        order_in_frame
      )
    `)
    .eq('id', frameId)
    .single();

  if (error || !frame) {
    throw new InternalError(`Failed to fetch frame: ${error?.message}`);
  }

  return frame as MatchFrame;
}

/**
 * Get or create a frame for a bracket match, returning frame with results
 */
export async function getOrCreateFrameWithResults(
  supabase: PrivilegedClient,
  bracketMatchId: number,
  frameNumber: number,
  isOvertime: boolean
): Promise<MatchFrame> {
  // Try to find existing frame with results
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

  // Create new frame and return with empty results
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

export interface FrameWithBracketMatch {
  id: string;
  bracket_match_id: number;
  bracket_match: {
    event_id: string;
  };
}

/**
 * Get a frame with its bracket match information for event validation
 */
export async function getFrameWithBracketMatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  frameId: string
): Promise<FrameWithBracketMatch | null> {
  const { data: frame, error } = await supabase
    .from('match_frames')
    .select('id, bracket_match_id, bracket_match:bracket_match(event_id)')
    .eq('id', frameId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch frame: ${error.message}`);
  }

  return frame as unknown as FrameWithBracketMatch | null;
}

export interface UpsertFrameResultInput {
  match_frame_id: string;
  event_player_id: string;
  bracket_match_id: number;
  putts_made: number;
  points_earned: number;
  order_in_frame?: number;
}

/**
 * Upsert a single frame result
 */
export async function upsertFrameResult(
  supabase: PrivilegedClient,
  data: UpsertFrameResultInput
): Promise<FrameResult> {
  const { data: result, error } = await supabase
    .from('frame_results')
    .upsert(
      {
        match_frame_id: data.match_frame_id,
        event_player_id: data.event_player_id,
        bracket_match_id: data.bracket_match_id,
        putts_made: data.putts_made,
        points_earned: data.points_earned,
        order_in_frame: data.order_in_frame,
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

