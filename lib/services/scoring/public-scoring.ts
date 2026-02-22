import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { releaseAndReassignLanePublic } from '@/lib/services/lane';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from '@/lib/errors';
import { calculatePoints } from './points-calculator';
import { completeMatch } from './match-completion';
import {
  getOrCreateFrame,
  upsertFrameResultAtomic,
  bulkUpsertFrameResults,
} from '@/lib/repositories/frame-repository';
import { getPublicTeamFromParticipant, getTeamFromParticipant, getTeamIdsFromParticipants, verifyPlayerInTeams, verifyPlayersInTeams } from '@/lib/repositories/team-repository';
import { getEventByAccessCodeForBracket, getEventStatusByAccessCode, getEventBracketFrameCount, getEventScoringConfig } from '@/lib/repositories/event-repository';
import { getLaneLabelsForEvent } from '@/lib/repositories/lane-repository';
import {
  getMatchesForScoringByEvent,
  getMatchForScoringById,
  updateMatchStatus,
  getMatchByIdAndEvent,
} from '@/lib/repositories/bracket-repository';
import type { PublicMatchDetails, OpponentData } from '@/lib/types/scoring';
import { InternalError } from '@/lib/errors';
import {
  validateQualificationAccessCode,
  getPlayersForQualification,
} from '@/lib/services/qualification';
import type {
  PublicEventInfo,
  PublicMatchInfo,
} from '@/lib/types/scoring';
import { MatchStatus } from '@/lib/types/bracket';

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
 * Get event scoring context based on access code
 * Determines if event is in qualification or bracket mode
 */
export async function getEventScoringContext(accessCode: string) {
  const supabase = await createClient();
  const cleanedAccessCode = accessCode.trim();
  const eventCheck = await getEventStatusByAccessCode(supabase, cleanedAccessCode);

  if (!eventCheck) {
    throw new NotFoundError('Invalid access code');
  }

  // Handle qualification mode
  if (eventCheck.status === 'pre-bracket' && eventCheck.qualification_round_enabled) {
    const event = await validateQualificationAccessCode(cleanedAccessCode);
    const players = await getPlayersForQualification(cleanedAccessCode);

    return {
      mode: 'qualification' as const,
      event,
      players,
    };
  }

  // Handle bracket mode
  if (eventCheck.status === 'bracket') {
    const event = await validateAccessCode(cleanedAccessCode, supabase);
    const matches = await getMatchesForScoring(cleanedAccessCode);

    return {
      mode: 'bracket' as const,
      event,
      matches,
    };
  }

  // Event is not in a scoreable state
  throw new BadRequestError('Event is not accepting scores at this time');
}

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
  const cleanedAccessCode = accessCode.trim();

  const event = await getEventByAccessCodeForBracket(supabase, cleanedAccessCode);

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
  const [laneMap, bracketMatches] = await Promise.all([
    getLaneLabelsForEvent(supabase, event.id),
    getMatchesForScoringByEvent(supabase, event.id),
  ]);

  if (bracketMatches.length === 0) {
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
  const [laneMap, bracketMatch] = await Promise.all([
    getLaneLabelsForEvent(supabase, event.id),
    getMatchForScoringById(supabase, bracketMatchId),
  ]);

  if (!bracketMatch) {
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
  const bracketMatch = await getMatchByIdAndEvent(supabase, bracketMatchId, event.id);

  if (!bracketMatch) {
    throw new NotFoundError('Match not found');
  }

  if (bracketMatch.status === 4) { // Completed
    throw new BadRequestError('Match is already completed');
  }

  // Verify player belongs to one of the teams in this match
  const participantIds = [bracketMatch.opponent1?.id, bracketMatch.opponent2?.id].filter((id): id is number => id !== null);

  if (participantIds.length === 0) {
    throw new BadRequestError('Match has no participants yet');
  }

  // Validate putts early (no DB needed)
  if (puttsMade < 0 || puttsMade > 3) {
    throw new BadRequestError('Putts must be between 0 and 3');
  }

  // Calculate points using server-validated event setting (not client-provided value)
  const pointsEarned = calculatePoints(puttsMade, event.bonus_point_enabled);
  const isOvertime = frameNumber > event.bracket_frame_count;

  // Parallel: Get team IDs and get/create frame simultaneously
  const [teamIds, frame] = await Promise.all([
    getTeamIdsFromParticipants(supabase, participantIds),
    getOrCreateFrame(supabase, bracketMatchId, frameNumber, isOvertime),
  ]);

  if (teamIds.length === 0) {
    throw new BadRequestError('Match teams not found');
  }

  // Verify player is in this match
  const playerInMatch = await verifyPlayerInTeams(supabase, eventPlayerId, teamIds);

  if (!playerInMatch) {
    throw new BadRequestError('Player is not in this match');
  }

  await upsertFrameResultAtomic(supabase, {
    matchFrameId: frame.id,
    eventPlayerId,
    bracketMatchId,
    puttsMade,
    pointsEarned,
  });

  // Update bracket match status to Running if Ready
  if (bracketMatch.status === 2) { // Ready
    await updateMatchStatus(supabase, bracketMatchId, 3); // Running
  }
}

/**
 * Record a score and return updated match (combined operation with shared client)
 * This avoids creating two separate clients and duplicating validation
 */
export async function recordScoreAndGetMatch(
  accessCode: string,
  bracketMatchId: number,
  frameNumber: number,
  eventPlayerId: string,
  puttsMade: number
): Promise<PublicMatchInfo> {
  // Create client once and reuse for ALL operations
  const supabase = await createClient();

  const event = await validateAccessCode(accessCode, supabase);

  // Verify bracket match belongs to event and get opponent info
  const bracketMatch = await getMatchByIdAndEvent(supabase, bracketMatchId, event.id);

  if (!bracketMatch) {
    throw new NotFoundError('Match not found');
  }

  if (bracketMatch.status === 4) {
    throw new BadRequestError('Match is already completed');
  }

  const participantIds = [bracketMatch.opponent1?.id, bracketMatch.opponent2?.id].filter((id): id is number => id !== null);

  if (participantIds.length === 0) {
    throw new BadRequestError('Match has no participants yet');
  }

  if (puttsMade < 0 || puttsMade > 3) {
    throw new BadRequestError('Putts must be between 0 and 3');
  }

  const pointsEarned = calculatePoints(puttsMade, event.bonus_point_enabled);
  const isOvertime = frameNumber > event.bracket_frame_count;

  // Parallel: Get team IDs and get/create frame simultaneously
  const [teamIds, frame] = await Promise.all([
    getTeamIdsFromParticipants(supabase, participantIds),
    getOrCreateFrame(supabase, bracketMatchId, frameNumber, isOvertime),
  ]);

  if (teamIds.length === 0) {
    throw new BadRequestError('Match teams not found');
  }

  // Verify player is in this match
  const playerInMatch = await verifyPlayerInTeams(supabase, eventPlayerId, teamIds);

  if (!playerInMatch) {
    throw new BadRequestError('Player is not in this match');
  }

  await upsertFrameResultAtomic(supabase, {
    matchFrameId: frame.id,
    eventPlayerId,
    bracketMatchId,
    puttsMade,
    pointsEarned,
  });

  // Update bracket match status to Running if Ready
  let newStatus = bracketMatch.status;
  if (bracketMatch.status === 2) {
    newStatus = 3;
    await updateMatchStatus(supabase, bracketMatchId, newStatus);
  }

  // Fetch updated match data using repository
  const updatedMatch = await getMatchForScoringById(supabase, bracketMatchId);

  if (!updatedMatch) {
    throw new NotFoundError('Match data not found');
  }

  // Fetch lanes and teams for response
  const [laneMap, team_one, team_two] = await Promise.all([
    getLaneLabelsForEvent(supabase, event.id),
    getPublicTeamFromParticipant(supabase, bracketMatch.opponent1?.id ?? null),
    getPublicTeamFromParticipant(supabase, bracketMatch.opponent2?.id ?? null),
  ]);

  if (!team_one || !team_two) {
    throw new NotFoundError('Match data not found');
  }

  const updatedOpponent1 = updatedMatch.opponent1 as { id?: number; score?: number } | null;
  const updatedOpponent2 = updatedMatch.opponent2 as { id?: number; score?: number } | null;

  return {
    id: bracketMatchId,
    round_id: updatedMatch.round_id,
    number: updatedMatch.number,
    status: newStatus,
    lane_id: updatedMatch.lane_id,
    lane_label: updatedMatch.lane_id ? laneMap[updatedMatch.lane_id] || null : null,
    team_one,
    team_two,
    team_one_score: updatedOpponent1?.score ?? 0,
    team_two_score: updatedOpponent2?.score ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    frames: ((updatedMatch.frames || []) as any[]).sort((a, b) => a.frame_number - b.frame_number),
  };
}

/**
 * Input for a single score in a batch operation
 */
export interface BatchScoreInput {
  event_player_id: string;
  putts_made: number;
}

/**
 * Record multiple scores for a single frame and return updated match
 * This reduces API calls by batching all frame scores into one request
 */
export async function batchRecordScoresAndGetMatch(
  accessCode: string,
  bracketMatchId: number,
  frameNumber: number,
  scores: BatchScoreInput[]
): Promise<PublicMatchInfo> {
  const supabase = await createClient();
  const event = await validateAccessCode(accessCode, supabase);

  // Verify bracket match belongs to event and get opponent info
  const bracketMatch = await getMatchByIdAndEvent(supabase, bracketMatchId, event.id);

  if (!bracketMatch) {
    throw new NotFoundError('Match not found');
  }

  if (bracketMatch.status === 4) {
    throw new BadRequestError('Match is already completed');
  }

  const participantIds = [bracketMatch.opponent1?.id, bracketMatch.opponent2?.id].filter((id): id is number => id !== null);

  if (participantIds.length === 0) {
    throw new BadRequestError('Match has no participants yet');
  }

  // Validate all scores upfront
  for (const score of scores) {
    if (score.putts_made < 0 || score.putts_made > 3) {
      throw new BadRequestError('Putts must be between 0 and 3');
    }
  }

  // Get team IDs and frame once for all scores
  const isOvertime = frameNumber > event.bracket_frame_count;
  const [teamIds, frame] = await Promise.all([
    getTeamIdsFromParticipants(supabase, participantIds),
    getOrCreateFrame(supabase, bracketMatchId, frameNumber, isOvertime),
  ]);

  if (teamIds.length === 0) {
    throw new BadRequestError('Match teams not found');
  }

  // Verify all players are in this match
  if (scores.length > 0) {
    const playerIdsToVerify = scores.map(s => s.event_player_id);
    const allPlayersInMatch = await verifyPlayersInTeams(supabase, playerIdsToVerify, teamIds);

    if (!allPlayersInMatch) {
      throw new BadRequestError('One or more players are not in this match');
    }
  }

  // Record all scores in a single batch operation
  if (scores.length > 0) {
    const resultsToUpsert = scores.map((score) => ({
      match_frame_id: frame.id,
      event_player_id: score.event_player_id,
      bracket_match_id: bracketMatchId,
      putts_made: score.putts_made,
      points_earned: calculatePoints(score.putts_made, event.bonus_point_enabled),
    }));

    await bulkUpsertFrameResults(supabase, resultsToUpsert);
  }

  // Update bracket match status to Running if Ready
  let newStatus = bracketMatch.status;
  if (bracketMatch.status === 2 && scores.length > 0) {
    newStatus = 3;
    await updateMatchStatus(supabase, bracketMatchId, newStatus);
  }

  // Fetch updated match data using repository
  const updatedMatch = await getMatchForScoringById(supabase, bracketMatchId);

  if (!updatedMatch) {
    throw new NotFoundError('Match data not found');
  }

  // Fetch lanes and teams for response
  const [laneMap, team_one, team_two] = await Promise.all([
    getLaneLabelsForEvent(supabase, event.id),
    getPublicTeamFromParticipant(supabase, bracketMatch.opponent1?.id ?? null),
    getPublicTeamFromParticipant(supabase, bracketMatch.opponent2?.id ?? null),
  ]);

  if (!team_one || !team_two) {
    throw new NotFoundError('Match data not found');
  }

  const updatedOpponent1 = updatedMatch.opponent1 as { id?: number; score?: number } | null;
  const updatedOpponent2 = updatedMatch.opponent2 as { id?: number; score?: number } | null;

  return {
    id: bracketMatchId,
    round_id: updatedMatch.round_id,
    number: updatedMatch.number,
    status: newStatus,
    lane_id: updatedMatch.lane_id,
    lane_label: updatedMatch.lane_id ? laneMap[updatedMatch.lane_id] || null : null,
    team_one,
    team_two,
    team_one_score: updatedOpponent1?.score ?? 0,
    team_two_score: updatedOpponent2?.score ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    frames: ((updatedMatch.frames || []) as any[]).sort((a, b) => a.frame_number - b.frame_number),
  };
}

/**
 * Get bracket match with full details for public (anon) access.
 * Mirrors getBracketMatchWithDetails but uses the anon client (respects RLS).
 * The get_frame_results_for_match RPC is gated to events in 'bracket' status,
 * so frame data is only visible while bracket play is active.
 */
export async function getPublicMatchDetails(
  eventId: string,
  matchId: number
): Promise<PublicMatchDetails> {
  const supabase = await createClient();

  const [bracketMatch, bracketFrameCount, eventConfig] = await Promise.all([
    getMatchForScoringById(supabase, matchId),
    getEventBracketFrameCount(supabase, eventId),
    getEventScoringConfig(supabase, eventId),
  ]);

  if (!bracketMatch || bracketMatch.event_id !== eventId) {
    throw new NotFoundError('Match not found');
  }

  if (bracketFrameCount === null || !eventConfig) {
    throw new InternalError('Event scoring configuration not found');
  }

  const opponent1 = bracketMatch.opponent1 as OpponentData | null;
  const opponent2 = bracketMatch.opponent2 as OpponentData | null;

  const [team_one, team_two] = await Promise.all([
    getTeamFromParticipant(supabase, opponent1?.id ?? null),
    getTeamFromParticipant(supabase, opponent2?.id ?? null),
  ]);

  return {
    id: bracketMatch.id,
    event_id: bracketMatch.event_id,
    round_id: bracketMatch.round_id,
    number: bracketMatch.number,
    status: bracketMatch.status,
    lane_id: bracketMatch.lane_id,
    opponent1,
    opponent2,
    team_one,
    team_two,
    frames: bracketMatch.frames?.sort((a, b) => a.frame_number - b.frame_number) ?? [],
    bracket_frame_count: bracketFrameCount,
    bonus_point_enabled: eventConfig.bonus_point_enabled,
  };
}

/**
 * Start a match (transition Ready → Running) when public scorer begins scoring.
 * Idempotent: no-op if match is already Running.
 */
export async function startMatchPublic(
  accessCode: string,
  bracketMatchId: number
): Promise<void> {
  const supabase = await createClient();
  const event = await validateAccessCode(accessCode, supabase);

  const bracketMatch = await getMatchByIdAndEvent(supabase, bracketMatchId, event.id);

  if (!bracketMatch) {
    throw new NotFoundError('Match not found');
  }

  if (bracketMatch.status === MatchStatus.Ready) {
    if (bracketMatch.lane_id === null) {
      throw new BadRequestError('Match has no lane assigned');
    }
    await updateMatchStatus(supabase, bracketMatchId, MatchStatus.Running);
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

  // Try to re-fetch the match for accurate data, but fall back to pre-fetched
  // data with updated status if the query times out (the client redirects
  // immediately anyway and doesn't use the response body)
  try {
    return await getMatchForScoring(accessCode, bracketMatchId, supabase);
  } catch (fetchError) {
    console.error('Failed to fetch updated match after completion:', fetchError);
    return {
      ...match,
      status: MatchStatus.Completed,
    };
  }
}
