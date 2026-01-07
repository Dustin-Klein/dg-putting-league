import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { releaseAndReassignLanePublic } from '@/lib/services/lane';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
  ForbiddenError,
} from '@/lib/errors';
import { calculatePoints } from './points-calculator';
import { completeMatch } from './match-completion';
import { getOrCreateFrame, getPlayerFrameResult, getMaxOrderInFrame, upsertFrameResult } from '@/lib/repositories/frame-repository';
import { getPublicTeamFromParticipant, getTeamIdsFromParticipants, verifyPlayerInTeams } from '@/lib/repositories/team-repository';
import type {
  PublicEventInfo,
  PublicMatchInfo,
} from '@/lib/types/scoring';

// Re-export types for consumers
export type {
  PublicEventInfo,
  PublicMatchInfo,
  PublicTeamInfo,
  PublicPlayerInfo,
  PublicFrameInfo,
  PublicFrameResult,
} from '@/lib/types/scoring';

/**
 * Validate access code and get event info
 * @param accessCode - The event access code
 * @param supabaseClient - Optional existing Supabase client (for connection reuse)
 */
export async function validateAccessCode(
  accessCode: string,
  supabaseClient?: Awaited<ReturnType<typeof createClient>>
): Promise<PublicEventInfo> {
  const supabase = supabaseClient ?? await createClient();

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
 * Get matches ready for scoring (status = ready or in_progress)
 */
export async function getMatchesForScoring(accessCode: string): Promise<PublicMatchInfo[]> {
  const supabase = await createClient();
  const event = await validateAccessCode(accessCode, supabase);

  // Parallel: Get lanes and bracket matches simultaneously
  const [lanesResult, bracketMatchesResult] = await Promise.all([
    supabase
      .from('lanes')
      .select('id, label')
      .eq('event_id', event.id),
    supabase
      .from('bracket_match')
      .select(`
        id,
        status,
        round_id,
        number,
        lane_id,
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
      .in('status', [2, 3]) // Ready = 2, Running = 3
      .not('lane_id', 'is', null), // Only show matches with a lane assigned
  ]);

  const lanes = lanesResult.data;
  const laneMap: Record<string, string> = {};
  lanes?.forEach((lane) => {
    laneMap[lane.id] = lane.label;
  });

  const { data: bracketMatches, error: bracketError } = bracketMatchesResult;

  if (bracketError) {
    throw new InternalError('Failed to fetch matches');
  }

  if (!bracketMatches || bracketMatches.length === 0) {
    return [];
  }

  // Parallel: Fetch all teams for all matches simultaneously
  const teamPromises = bracketMatches.flatMap((bm) => {
    const opponent1 = bm.opponent1 as { id?: number; score?: number } | null;
    const opponent2 = bm.opponent2 as { id?: number; score?: number } | null;
    return [
      getPublicTeamFromParticipant(supabase, opponent1?.id ?? null),
      getPublicTeamFromParticipant(supabase, opponent2?.id ?? null),
    ];
  });

  const teams = await Promise.all(teamPromises);

  // Build matches from results
  const matches: PublicMatchInfo[] = [];

  for (let i = 0; i < bracketMatches.length; i++) {
    const bm = bracketMatches[i];
    const team_one = teams[i * 2];
    const team_two = teams[i * 2 + 1];

    // Skip matches without both teams
    if (!team_one || !team_two) continue;

    const opponent1 = bm.opponent1 as { id?: number; score?: number } | null;
    const opponent2 = bm.opponent2 as { id?: number; score?: number } | null;

    matches.push({
      id: bm.id,
      round_id: bm.round_id,
      number: bm.number,
      status: bm.status,
      lane_id: bm.lane_id,
      lane_label: bm.lane_id ? laneMap[bm.lane_id] || null : null,
      team_one,
      team_two,
      team_one_score: opponent1?.score ?? 0,
      team_two_score: opponent2?.score ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  bracketMatchId: number,
  supabaseClient?: Awaited<ReturnType<typeof createClient>>
): Promise<PublicMatchInfo> {
  const supabase = supabaseClient ?? await createClient();
  const event = await validateAccessCode(accessCode, supabase);

  // Parallel: Get lanes and bracket match simultaneously
  const [lanesResult, bracketMatchResult] = await Promise.all([
    supabase
      .from('lanes')
      .select('id, label')
      .eq('event_id', event.id),
    supabase
      .from('bracket_match')
      .select(`
        id,
        status,
        round_id,
        number,
        lane_id,
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
      .single(),
  ]);

  const lanes = lanesResult.data;
  const laneMap: Record<string, string> = {};
  lanes?.forEach((lane) => {
    laneMap[lane.id] = lane.label;
  });

  const { data: bracketMatch, error } = bracketMatchResult;

  if (error || !bracketMatch) {
    throw new NotFoundError('Match not found');
  }

  if (bracketMatch.event_id !== event.id) {
    throw new ForbiddenError('Match does not belong to this event');
  }

  const opponent1 = bracketMatch.opponent1 as { id?: number; score?: number } | null;
  const opponent2 = bracketMatch.opponent2 as { id?: number; score?: number } | null;

  const [team_one, team_two] = await Promise.all([
    getPublicTeamFromParticipant(supabase, opponent1?.id ?? null),
    getPublicTeamFromParticipant(supabase, opponent2?.id ?? null),
  ]);

  if (!team_one || !team_two) {
    throw new NotFoundError('Match teams not found');
  }

  return {
    id: bracketMatch.id,
    round_id: bracketMatch.round_id,
    number: bracketMatch.number,
    status: bracketMatch.status,
    lane_id: bracketMatch.lane_id,
    lane_label: bracketMatch.lane_id ? laneMap[bracketMatch.lane_id] || null : null,
    team_one,
    team_two,
    team_one_score: opponent1?.score ?? 0,
    team_two_score: opponent2?.score ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  puttsMade: number
): Promise<void> {
  // Create client once and reuse for all operations
  const supabase = await createClient();
  const event = await validateAccessCode(accessCode, supabase);

  // Verify bracket match belongs to event and get opponent info
  const { data: bracketMatch } = await supabase
    .from('bracket_match')
    .select('id, event_id, status, opponent1, opponent2')
    .eq('id', bracketMatchId)
    .single();

  if (!bracketMatch || bracketMatch.event_id !== event.id) {
    throw new NotFoundError('Match not found');
  }

  if (bracketMatch.status === 4) { // Completed
    throw new BadRequestError('Match is already completed');
  }

  // Verify player belongs to one of the teams in this match
  const opponent1 = bracketMatch.opponent1 as { id: number | null } | null;
  const opponent2 = bracketMatch.opponent2 as { id: number | null } | null;
  const participantIds = [opponent1?.id, opponent2?.id].filter((id): id is number => id !== null);

  if (participantIds.length === 0) {
    throw new BadRequestError('Match has no participants yet');
  }

  // Validate putts early (no DB needed)
  if (puttsMade < 0 || puttsMade > 3) {
    throw new BadRequestError('Putts must be between 0 and 3');
  }

  // Calculate points using server-validated event setting (not client-provided value)
  const pointsEarned = calculatePoints(puttsMade, event.bonus_point_enabled);

  // Parallel: Get team IDs and get/create frame simultaneously
  const [teamIds, frame] = await Promise.all([
    getTeamIdsFromParticipants(supabase, participantIds),
    getOrCreateFrame(supabase, bracketMatchId, frameNumber),
  ]);

  if (teamIds.length === 0) {
    throw new BadRequestError('Match teams not found');
  }

  // Parallel: Verify player in teams and get existing result simultaneously
  const [playerInMatch, existingResult] = await Promise.all([
    verifyPlayerInTeams(supabase, eventPlayerId, teamIds),
    getPlayerFrameResult(supabase, frame.id, eventPlayerId),
  ]);

  if (!playerInMatch) {
    throw new BadRequestError('Player is not in this match');
  }

  // Determine order in frame for this player
  let orderInFrame: number;
  if (existingResult?.order_in_frame) {
    orderInFrame = existingResult.order_in_frame;
  } else {
    // Optimized: fetch only max order instead of all results
    const maxOrder = await getMaxOrderInFrame(supabase, frame.id);
    orderInFrame = maxOrder + 1;
  }

  // Upsert the result using repository
  await upsertFrameResult(supabase, {
    matchFrameId: frame.id,
    eventPlayerId,
    bracketMatchId,
    puttsMade,
    pointsEarned,
    orderInFrame,
  });

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
  // Create client once and reuse for all operations
  const supabase = await createClient();
  const event = await validateAccessCode(accessCode, supabase);

  // Get match with scores (reuse client)
  const match = await getMatchForScoring(accessCode, bracketMatchId, supabase);

  if (match.team_one_score === match.team_two_score) {
    throw new BadRequestError('Match cannot be completed with a tied score. Continue scoring in overtime.');
  }

  // Use shared match completion logic
  await completeMatch(supabase, event.id, bracketMatchId, {
    team1Score: match.team_one_score,
    team2Score: match.team_two_score,
  });

  // Release the lane and auto-assign to next ready match
  try {
    await releaseAndReassignLanePublic(event.id, bracketMatchId);
  } catch (laneError) {
    // Log but don't fail - lane management is secondary to match completion
    console.error('Failed to release lane and reassign:', laneError);
  }

  return getMatchForScoring(accessCode, bracketMatchId, supabase);
}
