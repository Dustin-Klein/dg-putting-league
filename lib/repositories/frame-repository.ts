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

/**
 * Get or create a frame for a bracket match, returning frame with results
 */
export async function getOrCreateFrameWithResults(
  supabase: Awaited<ReturnType<typeof createClient>>,
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
  supabase: Awaited<ReturnType<typeof createClient>>,
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

export interface UpsertFrameResultAtomicParams {
  matchFrameId: string;
  eventPlayerId: string;
  bracketMatchId: number;
  puttsMade: number;
  pointsEarned: number;
}

/**
 * Atomically upsert a frame result with correct order_in_frame via RPC
 * Handles race conditions where concurrent requests could assign duplicate order values
 */
export async function upsertFrameResultAtomic(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: UpsertFrameResultAtomicParams
): Promise<void> {
  const { error } = await supabase.rpc('upsert_frame_result_atomic', {
    p_match_frame_id: params.matchFrameId,
    p_event_player_id: params.eventPlayerId,
    p_bracket_match_id: params.bracketMatchId,
    p_putts_made: params.puttsMade,
    p_points_earned: params.pointsEarned,
  });

  if (error) {
    throw new InternalError(`Failed to record score: ${error.message}`);
  }
}

export interface BulkFrameResultInput {
  match_frame_id: string;
  event_player_id: string;
  bracket_match_id: number;
  putts_made: number;
  points_earned: number;
}

/**
 * Bulk upsert multiple frame results via RPC
 */
export async function bulkUpsertFrameResults(
  supabase: Awaited<ReturnType<typeof createClient>>,
  results: BulkFrameResultInput[]
): Promise<void> {
  const { error } = await supabase.rpc('bulk_upsert_frame_results', {
    p_results: results,
  });

  if (error) {
    throw new InternalError(`Failed to record scores: ${error.message}`);
  }
}
