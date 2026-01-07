import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';
import type { MatchFrame, FrameResult } from '@/lib/types/scoring';

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
): Promise<FrameResult> {
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

  return result as FrameResult;
}

/**
 * Get existing results for a frame to determine order
 */
export async function getFrameResults(
  supabase: Awaited<ReturnType<typeof createClient>>,
  frameId: string
): Promise<FrameResult[]> {
  const { data: results, error } = await supabase
    .from('frame_results')
    .select('*')
    .eq('match_frame_id', frameId);

  if (error) {
    throw new InternalError(`Failed to fetch frame results: ${error.message}`);
  }

  return (results || []) as FrameResult[];
}

/**
 * Get the maximum order_in_frame for a frame
 * Optimized: Uses SQL aggregation instead of fetching all rows
 */
export async function getMaxOrderInFrame(
  supabase: Awaited<ReturnType<typeof createClient>>,
  frameId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('frame_results')
    .select('order_in_frame')
    .eq('match_frame_id', frameId)
    .order('order_in_frame', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch max order_in_frame: ${error.message}`);
  }

  return data?.order_in_frame ?? 0;
}

/**
 * Get a specific player's result for a frame
 */
export async function getPlayerFrameResult(
  supabase: Awaited<ReturnType<typeof createClient>>,
  frameId: string,
  eventPlayerId: string
): Promise<FrameResult | null> {
  const { data: result, error } = await supabase
    .from('frame_results')
    .select('*')
    .eq('match_frame_id', frameId)
    .eq('event_player_id', eventPlayerId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch player frame result: ${error.message}`);
  }

  return result as FrameResult | null;
}
