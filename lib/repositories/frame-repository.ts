import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';
import type { MatchFrame } from '@/lib/types/scoring';

// Partial type for queries without results join
export type FrameData = Omit<MatchFrame, 'results'>;

/**
 * Get or create a frame for a bracket match
 * Returns existing frame if found, otherwise creates new one
 */
export async function getOrCreateFrame(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bracketMatchId: number,
  frameNumber: number,
  isOvertime: boolean
): Promise<FrameData> {
  // Try to find existing frame
  const { data: existingFrame, error: frameQueryError } = await supabase
    .from('match_frames')
    .select('id, bracket_match_id, frame_number, is_overtime')
    .eq('bracket_match_id', bracketMatchId)
    .eq('frame_number', frameNumber)
    .maybeSingle();

  if (frameQueryError) {
    throw new InternalError(`Failed to query frame: ${frameQueryError.message}`);
  }

  if (existingFrame) {
    return existingFrame as FrameData;
  }

  // Create new frame
  const { data: newFrame, error } = await supabase
    .from('match_frames')
    .insert({
      bracket_match_id: bracketMatchId,
      frame_number: frameNumber,
      is_overtime: isOvertime,
    })
    .select('id, bracket_match_id, frame_number, is_overtime')
    .single();

  if (error || !newFrame) {
    throw new InternalError(`Failed to create frame: ${error?.message}`);
  }

  return newFrame as FrameData;
}

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
