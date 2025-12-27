import 'server-only';
import { BracketsManager } from 'brackets-manager';
import { createClient } from '@/lib/supabase/server';
import { SupabaseBracketStorage } from '@/lib/bracket/storage';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
  ForbiddenError,
} from '@/lib/errors';

export interface PublicEventInfo {
  id: string;
  event_date: string;
  location: string | null;
  lane_count: number;
  bonus_point_enabled: boolean;
  status: string;
}

export interface PublicMatchInfo {
  id: number; // bracket_match_id (integer)
  round_id: number;
  number: number;
  status: number;
  team_one: PublicTeamInfo;
  team_two: PublicTeamInfo;
  team_one_score: number;
  team_two_score: number;
  frames: PublicFrameInfo[];
}

export interface PublicTeamInfo {
  id: string;
  seed: number;
  pool_combo: string;
  players: PublicPlayerInfo[];
}

export interface PublicPlayerInfo {
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
  full_name: string;
  nickname: string | null;
}

export interface PublicFrameInfo {
  id: string;
  frame_number: number;
  is_overtime: boolean;
  results: PublicFrameResult[];
}

export interface PublicFrameResult {
  id: string;
  event_player_id: string;
  putts_made: number;
  points_earned: number;
}

/**
 * Validate access code and get event info
 */
export async function validateAccessCode(accessCode: string): Promise<PublicEventInfo> {
  const supabase = await createClient();

  const { data: event, error } = await supabase
    .from('events')
    .select('id, event_date, location, lane_count, bonus_point_enabled, status')
    .eq('access_code', accessCode)
    .eq('status', 'bracket')
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to validate access code: ${error.message}`);
  }

  if (!event) {
    throw new NotFoundError('Invalid access code or event is not in bracket play');
  }

  return event as PublicEventInfo;
}

/**
 * Get team info from a bracket participant
 */
async function getTeamFromParticipant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  participantId: number | null
): Promise<PublicTeamInfo | null> {
  if (!participantId) return null;

  const { data: participant } = await supabase
    .from('bracket_participant')
    .select('team_id')
    .eq('id', participantId)
    .single();

  if (!participant?.team_id) return null;

  const { data: team } = await supabase
    .from('teams')
    .select(`
      id,
      seed,
      pool_combo,
      team_members(
        event_player_id,
        role,
        event_player:event_players(
          player:players(full_name, nickname)
        )
      )
    `)
    .eq('id', participant.team_id)
    .single();

  if (!team) return null;

  return {
    id: team.id,
    seed: team.seed,
    pool_combo: team.pool_combo,
    players: team.team_members?.map((tm: any) => ({
      event_player_id: tm.event_player_id,
      role: tm.role,
      full_name: tm.event_player?.player?.full_name || 'Unknown',
      nickname: tm.event_player?.player?.nickname,
    })) || [],
  };
}

/**
 * Get matches ready for scoring (status = ready or in_progress)
 */
export async function getMatchesForScoring(accessCode: string): Promise<PublicMatchInfo[]> {
  const event = await validateAccessCode(accessCode);
  const supabase = await createClient();

  // Get bracket matches that are ready or in progress
  const { data: bracketMatches, error: bracketError } = await supabase
    .from('bracket_match')
    .select(`
      id,
      status,
      round_id,
      number,
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
    .eq('event_id', event.id)
    .in('status', [2, 3]); // Ready = 2, Running = 3

  if (bracketError) {
    throw new InternalError('Failed to fetch matches');
  }

  if (!bracketMatches || bracketMatches.length === 0) {
    return [];
  }

  // Get detailed match info for each bracket match
  const matches: PublicMatchInfo[] = [];

  for (const bm of bracketMatches) {
    const opponent1 = bm.opponent1 as { id?: number; score?: number } | null;
    const opponent2 = bm.opponent2 as { id?: number; score?: number } | null;

    const [team_one, team_two] = await Promise.all([
      getTeamFromParticipant(supabase, opponent1?.id ?? null),
      getTeamFromParticipant(supabase, opponent2?.id ?? null),
    ]);

    // Skip matches without both teams
    if (!team_one || !team_two) continue;

    matches.push({
      id: bm.id,
      round_id: bm.round_id,
      number: bm.number,
      status: bm.status,
      team_one,
      team_two,
      team_one_score: opponent1?.score ?? 0,
      team_two_score: opponent2?.score ?? 0,
      frames: ((bm.frames || []) as any[]).sort((a, b) => a.frame_number - b.frame_number),
    });
  }

  return matches;
}

/**
 * Get a single match for scoring
 */
export async function getMatchForScoring(
  accessCode: string,
  bracketMatchId: number
): Promise<PublicMatchInfo> {
  const event = await validateAccessCode(accessCode);
  const supabase = await createClient();

  const { data: bracketMatch, error } = await supabase
    .from('bracket_match')
    .select(`
      id,
      status,
      round_id,
      number,
      opponent1,
      opponent2,
      event_id,
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
    .eq('id', bracketMatchId)
    .single();

  if (error || !bracketMatch) {
    throw new NotFoundError('Match not found');
  }

  if (bracketMatch.event_id !== event.id) {
    throw new ForbiddenError('Match does not belong to this event');
  }

  const opponent1 = bracketMatch.opponent1 as { id?: number; score?: number } | null;
  const opponent2 = bracketMatch.opponent2 as { id?: number; score?: number } | null;

  const [team_one, team_two] = await Promise.all([
    getTeamFromParticipant(supabase, opponent1?.id ?? null),
    getTeamFromParticipant(supabase, opponent2?.id ?? null),
  ]);

  if (!team_one || !team_two) {
    throw new NotFoundError('Match teams not found');
  }

  return {
    id: bracketMatch.id,
    round_id: bracketMatch.round_id,
    number: bracketMatch.number,
    status: bracketMatch.status,
    team_one,
    team_two,
    team_one_score: opponent1?.score ?? 0,
    team_two_score: opponent2?.score ?? 0,
    frames: ((bracketMatch.frames || []) as any[]).sort((a, b) => a.frame_number - b.frame_number),
  };
}

/**
 * Record a score for a player in a frame (public, access-code authenticated)
 */
export async function recordScore(
  accessCode: string,
  bracketMatchId: number,
  frameNumber: number,
  eventPlayerId: string,
  puttsMade: number,
  bonusPointEnabled: boolean
): Promise<void> {
  const event = await validateAccessCode(accessCode);
  const supabase = await createClient();

  // Verify bracket match belongs to event
  const { data: bracketMatch } = await supabase
    .from('bracket_match')
    .select('id, event_id, status')
    .eq('id', bracketMatchId)
    .single();

  if (!bracketMatch || bracketMatch.event_id !== event.id) {
    throw new NotFoundError('Match not found');
  }

  if (bracketMatch.status === 4) { // Completed
    throw new BadRequestError('Match is already completed');
  }

  // Validate putts
  if (puttsMade < 0 || puttsMade > 3) {
    throw new BadRequestError('Putts must be between 0 and 3');
  }

  // Calculate points
  const pointsEarned = puttsMade === 3 && bonusPointEnabled ? 4 : puttsMade;

  // Get or create frame
  let { data: frame } = await supabase
    .from('match_frames')
    .select('id')
    .eq('bracket_match_id', bracketMatchId)
    .eq('frame_number', frameNumber)
    .maybeSingle();

  if (!frame) {
    const { data: newFrame, error: frameError } = await supabase
      .from('match_frames')
      .insert({
        bracket_match_id: bracketMatchId,
        frame_number: frameNumber,
        is_overtime: frameNumber > 5,
      })
      .select('id')
      .single();

    if (frameError) {
      throw new InternalError(`Failed to create frame: ${frameError.message}`);
    }
    frame = newFrame;
  }

  // Get order in frame for this player
  const { data: existingResults } = await supabase
    .from('frame_results')
    .select('order_in_frame')
    .eq('match_frame_id', frame.id);

  const { data: existingResult } = await supabase
    .from('frame_results')
    .select('id, order_in_frame')
    .eq('match_frame_id', frame.id)
    .eq('event_player_id', eventPlayerId)
    .maybeSingle();

  const orderInFrame = existingResult?.order_in_frame ||
    (existingResults?.length || 0) + 1;

  // Upsert the result
  const { error: resultError } = await supabase
    .from('frame_results')
    .upsert(
      {
        match_frame_id: frame.id,
        event_player_id: eventPlayerId,
        putts_made: puttsMade,
        points_earned: pointsEarned,
        order_in_frame: orderInFrame,
      },
      { onConflict: 'match_frame_id,event_player_id' }
    );

  if (resultError) {
    throw new InternalError(`Failed to record score: ${resultError.message}`);
  }

  // Update bracket match status to Running if Ready
  if (bracketMatch.status === 2) { // Ready
    await supabase
      .from('bracket_match')
      .update({ status: 3 }) // Running
      .eq('id', bracketMatchId);
  }
}

/**
 * Complete a match (public, access-code authenticated)
 */
export async function completeMatchPublic(
  accessCode: string,
  bracketMatchId: number
): Promise<PublicMatchInfo> {
  const event = await validateAccessCode(accessCode);
  const supabase = await createClient();

  // Get match with scores
  const match = await getMatchForScoring(accessCode, bracketMatchId);

  if (match.team_one_score === match.team_two_score) {
    throw new BadRequestError('Match cannot be completed with a tied score. Continue scoring in overtime.');
  }

  const team1Won = match.team_one_score > match.team_two_score;

  // Update bracket match using brackets-manager
  const storage = new SupabaseBracketStorage(supabase, event.id);
  const manager = new BracketsManager(storage);

  try {
    await manager.update.match({
      id: bracketMatchId,
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
    console.error('Failed to update bracket:', bracketError);
    throw new InternalError(`Failed to complete match: ${bracketError}`);
  }

  return getMatchForScoring(accessCode, bracketMatchId);
}
