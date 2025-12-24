import 'server-only';
import { createClient } from '@/lib/supabase/server';
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
  id: string;
  bracket_match_id: number;
  round_name: string;
  status: string;
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
 * Uses a security definer function to bypass RLS for unauthenticated users
 */
export async function validateAccessCode(accessCode: string): Promise<PublicEventInfo> {
  const supabase = await createClient();

  const { data: event, error } = await supabase
    .rpc('validate_event_access_code', { p_access_code: accessCode });

  if (error) {
    throw new InternalError(`Failed to validate access code: ${error.message}`);
  }

  if (!event) {
    throw new NotFoundError('Invalid access code');
  }

  if (event.status !== 'bracket') {
    throw new BadRequestError('Event is not in bracket play');
  }

  return event as PublicEventInfo;
}

/**
 * Get matches ready for scoring (status = ready or in_progress)
 */
export async function getMatchesForScoring(accessCode: string): Promise<PublicMatchInfo[]> {
  const event = await validateAccessCode(accessCode);
  const supabase = await createClient();

  // Debug: Check all bracket matches for this event
  const { data: allMatches, error: allMatchesError } = await supabase
    .from('bracket_match')
    .select('id, status, round_id, number, opponent1, opponent2')
    .eq('event_id', event.id);

  console.log('All bracket matches for event:', event.id);
  console.log('All matches count:', allMatches?.length || 0);
  console.log('All matches error:', allMatchesError);
  console.log('All matches:', JSON.stringify(allMatches, null, 2));

  // Get bracket matches that are ready or in progress
  const { data: bracketMatches, error: bracketError } = await supabase
    .from('bracket_match')
    .select('id, status, round_id, number')
    .eq('event_id', event.id)
    .in('status', [2, 3]); // Ready = 2, Running = 3

  console.log('Ready/Running matches:', bracketMatches?.length || 0);
  console.log('Bracket error:', bracketError);

  if (bracketError) {
    throw new InternalError('Failed to fetch matches');
  }

  if (!bracketMatches || bracketMatches.length === 0) {
    return [];
  }

  // Get detailed match info for each bracket match
  const matches: PublicMatchInfo[] = [];

  for (const bm of bracketMatches) {
    // Get or check if match record exists
    let { data: match } = await supabase
      .from('match')
      .select(`
        id,
        bracket_match_id,
        round_name,
        status,
        team_one_score,
        team_two_score,
        team_one:teams!match_team_one_id_fkey(
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
        ),
        team_two:teams!match_team_two_id_fkey(
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
        ),
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
      .eq('bracket_match_id', bm.id)
      .maybeSingle();

    if (!match) {
      // Create match record if it doesn't exist
      const { data: newMatchId } = await supabase.rpc('create_match_for_bracket', {
        p_bracket_match_id: bm.id,
        p_event_id: event.id,
      });

      if (newMatchId) {
        // Fetch the newly created match
        const { data: newMatch } = await supabase
          .from('match')
          .select(`
            id,
            bracket_match_id,
            round_name,
            status,
            team_one_score,
            team_two_score,
            team_one:teams!match_team_one_id_fkey(
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
            ),
            team_two:teams!match_team_two_id_fkey(
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
            ),
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
          .eq('id', newMatchId)
          .single();

        match = newMatch;
      }
    }

    if (match) {
      const transformTeam = (team: any): PublicTeamInfo => ({
        id: team.id,
        seed: team.seed,
        pool_combo: team.pool_combo,
        players: team.team_members?.map((tm: any) => ({
          event_player_id: tm.event_player_id,
          role: tm.role,
          full_name: tm.event_player?.player?.full_name || 'Unknown',
          nickname: tm.event_player?.player?.nickname,
        })) || [],
      });

      matches.push({
        id: match.id,
        bracket_match_id: match.bracket_match_id,
        round_name: match.round_name,
        status: match.status,
        team_one: transformTeam(match.team_one),
        team_two: transformTeam(match.team_two),
        team_one_score: match.team_one_score || 0,
        team_two_score: match.team_two_score || 0,
        frames: (match.frames || []).sort((a: any, b: any) => a.frame_number - b.frame_number),
      });
    }
  }

  return matches;
}

/**
 * Get a single match for scoring
 */
export async function getMatchForScoring(
  accessCode: string,
  matchId: string
): Promise<PublicMatchInfo> {
  const event = await validateAccessCode(accessCode);
  const supabase = await createClient();

  const { data: match, error } = await supabase
    .from('match')
    .select(`
      id,
      bracket_match_id,
      round_name,
      status,
      team_one_score,
      team_two_score,
      event_id,
      team_one:teams!match_team_one_id_fkey(
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
      ),
      team_two:teams!match_team_two_id_fkey(
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
      ),
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
    .eq('id', matchId)
    .single();

  if (error || !match) {
    throw new NotFoundError('Match not found');
  }

  if (match.event_id !== event.id) {
    throw new ForbiddenError('Match does not belong to this event');
  }

  const transformTeam = (team: any): PublicTeamInfo => ({
    id: team.id,
    seed: team.seed,
    pool_combo: team.pool_combo,
    players: team.team_members?.map((tm: any) => ({
      event_player_id: tm.event_player_id,
      role: tm.role,
      full_name: tm.event_player?.player?.full_name || 'Unknown',
      nickname: tm.event_player?.player?.nickname,
    })) || [],
  });

  return {
    id: match.id,
    bracket_match_id: match.bracket_match_id,
    round_name: match.round_name,
    status: match.status,
    team_one: transformTeam(match.team_one),
    team_two: transformTeam(match.team_two),
    team_one_score: match.team_one_score || 0,
    team_two_score: match.team_two_score || 0,
    frames: (match.frames || []).sort((a: any, b: any) => a.frame_number - b.frame_number),
  };
}

/**
 * Record a score for a player in a frame (public, access-code authenticated)
 */
export async function recordScore(
  accessCode: string,
  matchId: string,
  frameNumber: number,
  eventPlayerId: string,
  puttsMade: number,
  bonusPointEnabled: boolean
): Promise<void> {
  const event = await validateAccessCode(accessCode);
  const supabase = await createClient();

  // Verify match belongs to event
  const { data: match } = await supabase
    .from('match')
    .select('id, event_id, status')
    .eq('id', matchId)
    .single();

  if (!match || match.event_id !== event.id) {
    throw new NotFoundError('Match not found');
  }

  if (match.status === 'completed') {
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
    .eq('match_id', matchId)
    .eq('frame_number', frameNumber)
    .maybeSingle();

  if (!frame) {
    const { data: newFrame, error: frameError } = await supabase
      .from('match_frames')
      .insert({
        match_id: matchId,
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

  // Update match status to in_progress if not already
  if (match.status === 'ready') {
    await supabase
      .from('match')
      .update({ status: 'in_progress' })
      .eq('id', matchId);

    // Also update bracket match status
    const { data: matchWithBracket } = await supabase
      .from('match')
      .select('bracket_match_id')
      .eq('id', matchId)
      .single();

    if (matchWithBracket?.bracket_match_id) {
      await supabase
        .from('bracket_match')
        .update({ status: 3 }) // Running
        .eq('id', matchWithBracket.bracket_match_id);
    }
  }
}

/**
 * Complete a match (public, access-code authenticated)
 */
export async function completeMatchPublic(
  accessCode: string,
  matchId: string
): Promise<PublicMatchInfo> {
  const event = await validateAccessCode(accessCode);
  const supabase = await createClient();

  // Get match with scores
  const match = await getMatchForScoring(accessCode, matchId);

  if (match.team_one_score === match.team_two_score) {
    throw new BadRequestError('Match cannot be completed with a tied score. Continue scoring in overtime.');
  }

  const winnerId = match.team_one_score > match.team_two_score
    ? match.team_one.id
    : match.team_two.id;

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

  // Update bracket match using brackets-manager
  if (match.bracket_match_id) {
    const { BracketsManager } = await import('brackets-manager');
    const { SupabaseBracketStorage } = await import('@/lib/bracket/storage');

    const team1Won = winnerId === match.team_one.id;
    const storage = new SupabaseBracketStorage(supabase, event.id);
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
      console.error('Failed to update bracket:', bracketError);
    }
  }

  return getMatchForScoring(accessCode, matchId);
}
