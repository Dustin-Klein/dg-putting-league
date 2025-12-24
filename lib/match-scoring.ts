import 'server-only';
import { BracketsManager } from 'brackets-manager';
import { createClient } from '@/lib/supabase/server';
import { SupabaseBracketStorage } from '@/lib/bracket/storage';
import { requireEventAdmin } from '@/lib/event';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '@/lib/errors';

export interface MatchWithDetails {
  id: string;
  event_id: string;
  bracket_match_id: number | null;
  round_name: string;
  round_number: number;
  match_order: number;
  bracket_side: 'upper' | 'lower' | 'final' | null;
  team_one_id: string | null;
  team_two_id: string | null;
  team_one_score: number;
  team_two_score: number;
  winner_team_id: string | null;
  status: 'pending' | 'ready' | 'in_progress' | 'completed';
  lane_id: string | null;
  team_one?: TeamWithPlayers;
  team_two?: TeamWithPlayers;
  frames?: MatchFrame[];
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
  match_id: string;
  frame_number: number;
  is_overtime: boolean;
  results: FrameResult[];
}

export interface FrameResult {
  id: string;
  match_frame_id: string;
  event_player_id: string;
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
 * Get or create a match record linked to a bracket match
 */
export async function getOrCreateMatchForBracket(
  eventId: string,
  bracketMatchId: number
): Promise<MatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  // Try to find existing match
  const { data: existingMatch } = await supabase
    .from('match')
    .select('*')
    .eq('bracket_match_id', bracketMatchId)
    .maybeSingle();

  if (existingMatch) {
    return getMatchWithDetails(eventId, existingMatch.id);
  }

  // Create new match using the database function
  const { data: matchId, error } = await supabase
    .rpc('create_match_for_bracket', {
      p_bracket_match_id: bracketMatchId,
      p_event_id: eventId,
    });

  if (error || !matchId) {
    throw new InternalError(`Failed to create match: ${error?.message}`);
  }

  return getMatchWithDetails(eventId, matchId);
}

/**
 * Get match with full details including teams and frames
 */
export async function getMatchWithDetails(
  eventId: string,
  matchId: string
): Promise<MatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  const { data: match, error } = await supabase
    .from('match')
    .select(`
      *,
      team_one:teams!match_team_one_id_fkey(
        id,
        seed,
        pool_combo,
        team_members(
          event_player_id,
          role,
          event_player:event_players(
            id,
            player:players(
              id,
              full_name,
              nickname
            )
          )
        )
      ),
      team_two:teams!match_team_two_id_fkey(
        id,
        seed,
        pool_combo,
        team_members(
          event_player_id,
          role,
          event_player:event_players(
            id,
            player:players(
              id,
              full_name,
              nickname
            )
          )
        )
      ),
      frames:match_frames(
        id,
        match_id,
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
    .eq('id', matchId)
    .eq('event_id', eventId)
    .single();

  if (error || !match) {
    throw new NotFoundError('Match not found');
  }

  // Transform team data
  const transformTeam = (team: any): TeamWithPlayers | undefined => {
    if (!team) return undefined;
    return {
      id: team.id,
      seed: team.seed,
      pool_combo: team.pool_combo,
      players: team.team_members?.map((tm: any) => ({
        event_player_id: tm.event_player_id,
        role: tm.role,
        player: tm.event_player?.player,
      })) || [],
    };
  };

  return {
    ...match,
    team_one: transformTeam(match.team_one),
    team_two: transformTeam(match.team_two),
    frames: match.frames?.sort((a: any, b: any) => a.frame_number - b.frame_number) || [],
  } as MatchWithDetails;
}

/**
 * Get match by bracket match ID
 */
export async function getMatchByBracketMatchId(
  eventId: string,
  bracketMatchId: number
): Promise<MatchWithDetails | null> {
  const { supabase } = await requireEventAdmin(eventId);

  const { data: match } = await supabase
    .from('match')
    .select('id')
    .eq('bracket_match_id', bracketMatchId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (!match) {
    return null;
  }

  return getMatchWithDetails(eventId, match.id);
}

/**
 * Create or get a frame for a match
 */
export async function getOrCreateFrame(
  eventId: string,
  matchId: string,
  frameNumber: number,
  isOvertime = false
): Promise<MatchFrame> {
  const { supabase } = await requireEventAdmin(eventId);

  // Verify match belongs to event
  const { data: match } = await supabase
    .from('match')
    .select('id, event_id')
    .eq('id', matchId)
    .eq('event_id', eventId)
    .single();

  if (!match) {
    throw new NotFoundError('Match not found');
  }

  // Try to find existing frame
  const { data: existingFrame } = await supabase
    .from('match_frames')
    .select(`
      *,
      results:frame_results(*)
    `)
    .eq('match_id', matchId)
    .eq('frame_number', frameNumber)
    .maybeSingle();

  if (existingFrame) {
    return existingFrame as MatchFrame;
  }

  // Create new frame
  const { data: newFrame, error } = await supabase
    .from('match_frames')
    .insert({
      match_id: matchId,
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

  // Verify frame belongs to a match in this event
  const { data: frame } = await supabase
    .from('match_frames')
    .select('id, match:match(event_id)')
    .eq('id', matchFrameId)
    .single();

  if (!frame || (frame.match as any)?.event_id !== eventId) {
    throw new NotFoundError('Frame not found');
  }

  // Validate putts and points
  if (input.putts_made < 0 || input.putts_made > 3) {
    throw new BadRequestError('Putts made must be between 0 and 3');
  }
  if (input.points_earned < 0 || input.points_earned > 4) {
    throw new BadRequestError('Points earned must be between 0 and 4');
  }

  // Upsert the frame result
  const { data: result, error } = await supabase
    .from('frame_results')
    .upsert(
      {
        match_frame_id: matchFrameId,
        event_player_id: input.event_player_id,
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
  matchId: string,
  frameNumber: number,
  results: RecordFrameResultInput[],
  isOvertime = false
): Promise<MatchFrame> {
  const { supabase } = await requireEventAdmin(eventId);

  // Get or create the frame
  const frame = await getOrCreateFrame(eventId, matchId, frameNumber, isOvertime);

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
 * Complete a match and update bracket progression
 */
export async function completeMatch(
  eventId: string,
  matchId: string
): Promise<MatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  // Get match with current scores
  const match = await getMatchWithDetails(eventId, matchId);

  if (match.team_one_score === match.team_two_score) {
    throw new BadRequestError('Match cannot be completed with a tied score');
  }

  const winnerId = match.team_one_score > match.team_two_score
    ? match.team_one_id
    : match.team_two_id;

  // Update match status
  const { error: matchError } = await supabase
    .from('match')
    .update({
      status: 'completed',
      winner_team_id: winnerId,
      completed_at: new Date().toISOString(),
    })
    .eq('id', matchId);

  if (matchError) {
    throw new InternalError(`Failed to complete match: ${matchError.message}`);
  }

  // If linked to bracket, update using brackets-manager for proper progression
  if (match.bracket_match_id) {
    const team1Won = winnerId === match.team_one_id;

    // Use brackets-manager to update the match (handles bracket progression)
    const storage = new SupabaseBracketStorage(supabase, eventId);
    const manager = new BracketsManager(storage);

    try {
      await manager.update.match({
        id: match.bracket_match_id,
        opponent1: {
          score: match.team_one_score,
          result: team1Won ? 'win' : 'loss',
        },
        opponent2: {
          score: match.team_two_score,
          result: team1Won ? 'loss' : 'win',
        },
      });
    } catch (bracketError) {
      console.error('Failed to update bracket match:', bracketError);
      // Don't throw - the match is already completed
    }
  }

  return getMatchWithDetails(eventId, matchId);
}

/**
 * Start a match (set status to in_progress)
 */
export async function startMatch(
  eventId: string,
  matchId: string
): Promise<MatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  const { error } = await supabase
    .from('match')
    .update({ status: 'in_progress' })
    .eq('id', matchId)
    .eq('event_id', eventId);

  if (error) {
    throw new InternalError(`Failed to start match: ${error.message}`);
  }

  // Also update bracket_match status if linked
  const { data: match } = await supabase
    .from('match')
    .select('bracket_match_id')
    .eq('id', matchId)
    .single();

  if (match?.bracket_match_id) {
    await supabase
      .from('bracket_match')
      .update({ status: 3 }) // Running
      .eq('id', match.bracket_match_id);
  }

  return getMatchWithDetails(eventId, matchId);
}

/**
 * Calculate points earned based on putts made and bonus point setting
 */
export function calculatePoints(puttsMade: number, bonusPointEnabled: boolean): number {
  if (puttsMade === 3 && bonusPointEnabled) {
    return 4; // Bonus point for making all 3
  }
  return puttsMade;
}
