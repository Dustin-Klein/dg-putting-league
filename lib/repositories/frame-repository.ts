import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';

export interface FrameData {
  id: string;
  bracket_match_id: number;
  frame_number: number;
  is_overtime: boolean;
}

export interface FrameWithResults extends FrameData {
  results: FrameResultData[];
}

export interface FrameResultData {
  id: string;
  match_frame_id: string;
  event_player_id: string;
  bracket_match_id?: number | null;
  putts_made: number;
  points_earned: number;
  order_in_frame: number;
}

/**
 * Get or create a frame for a bracket match
 * Returns existing frame if found, otherwise creates new one
 */
export async function getOrCreateFrame(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bracketMatchId: number,
  frameNumber: number,
  isOvertime?: boolean
): Promise<FrameData> {
  // Default isOvertime based on frame number if not provided
  const overtimeValue = isOvertime ?? frameNumber > 5;

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
      is_overtime: overtimeValue,
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
export async function getFrameWithResults(
  supabase: Awaited<ReturnType<typeof createClient>>,
  frameId: string
): Promise<FrameWithResults> {
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

  return frame as FrameWithResults;
}

/**
 * Upsert a frame result (create or update)
 */
export async function upsertFrameResult(
  supabase: Awaited<ReturnType<typeof createClient>>,
  data: {
    matchFrameId: string;
    eventPlayerId: string;
    bracketMatchId: number;
    puttsMade: number;
    pointsEarned: number;
    orderInFrame: number;
  }
): Promise<FrameResultData> {
  const { data: result, error } = await supabase
    .from('frame_results')
    .upsert(
      {
        match_frame_id: data.matchFrameId,
        event_player_id: data.eventPlayerId,
        bracket_match_id: data.bracketMatchId,
        putts_made: data.puttsMade,
        points_earned: data.pointsEarned,
        order_in_frame: data.orderInFrame,
      },
      { onConflict: 'match_frame_id,event_player_id' }
    )
    .select()
    .single();

  if (error || !result) {
    throw new InternalError(`Failed to upsert frame result: ${error?.message}`);
  }

  return result as FrameResultData;
}

/**
 * Get existing results for a frame to determine order
 */
export async function getFrameResults(
  supabase: Awaited<ReturnType<typeof createClient>>,
  frameId: string
): Promise<FrameResultData[]> {
  const { data: results, error } = await supabase
    .from('frame_results')
    .select('*')
    .eq('match_frame_id', frameId);

  if (error) {
    throw new InternalError(`Failed to fetch frame results: ${error.message}`);
  }

  return (results || []) as FrameResultData[];
}

/**
 * Get a specific player's result for a frame
 */
export async function getPlayerFrameResult(
  supabase: Awaited<ReturnType<typeof createClient>>,
  frameId: string,
  eventPlayerId: string
): Promise<FrameResultData | null> {
  const { data: result, error } = await supabase
    .from('frame_results')
    .select('*')
    .eq('match_frame_id', frameId)
    .eq('event_player_id', eventPlayerId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch player frame result: ${error.message}`);
  }

  return result as FrameResultData | null;
}
