import 'server-only';
import { requireEventAdmin } from '@/lib/services/event';
import { releaseMatchLaneAndReassign } from '@/lib/services/lane';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '@/lib/errors';
import { completeMatch, handleGrandFinalCompletion } from './match-completion';
import { calculatePoints } from './points-calculator';
import { getTeamFromParticipant, getTeamIdsFromParticipants, verifyPlayerInTeams } from '@/lib/repositories/team-repository';
import {
  getOrCreateFrame as getOrCreateFrameRepo,
  getOrCreateFrameWithResults,
  getFrameWithBracketMatch,
  upsertFrameResult,
  upsertFrameResultAtomic,
} from '@/lib/repositories/frame-repository';
import { getMatchFrame } from '@/lib/repositories/frame-repository';
import { getEventScoringConfig, getEventBracketFrameCount } from '@/lib/repositories/event-repository';
import {
  getMatchByIdAndEvent,
  getMatchWithOpponents,
  updateMatchOpponentScores,
  updateMatchStatus,
  getMatchForScoringById,
} from '@/lib/repositories/bracket-repository';
import type {
  BracketMatchWithDetails,
  OpponentData,
  MatchFrame,
  FrameResult,
  RecordFrameResultInput,
} from '@/lib/types/scoring';

export type {
  BracketMatchWithDetails,
  OpponentData,
  TeamWithPlayers,
  PlayerInTeam,
  MatchFrame,
  FrameResult,
  RecordFrameResultInput,
} from '@/lib/types/scoring';

export { calculatePoints } from './points-calculator';

/**
 * Record a score for a player in a frame (admin-authenticated)
 */
export async function recordScoreAdmin(
  eventId: string,
  bracketMatchId: number,
  frameNumber: number,
  eventPlayerId: string,
  puttsMade: number
): Promise<BracketMatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  if (puttsMade < 0 || puttsMade > 3) {
    throw new BadRequestError('Putts must be between 0 and 3');
  }

  if (!Number.isInteger(frameNumber) || frameNumber < 1) {
    throw new BadRequestError('Frame number must be a positive integer');
  }

  if (frameNumber > 50) {
    throw new BadRequestError('Frame number exceeds maximum allowed limit');
  }

  const [eventConfig, bracketFrameCount, bracketMatch] = await Promise.all([
    getEventScoringConfig(supabase, eventId),
    getEventBracketFrameCount(supabase, eventId),
    getMatchByIdAndEvent(supabase, bracketMatchId, eventId),
  ]);

  if (!eventConfig) {
    throw new NotFoundError('Event not found');
  }

  if (!bracketMatch) {
    throw new NotFoundError('Bracket match not found');
  }

  // Verify player belongs to one of the teams in this match
  const participantIds = [bracketMatch.opponent1?.id, bracketMatch.opponent2?.id].filter((id): id is number => id !== null);
  if (participantIds.length > 0) {
    const teamIds = await getTeamIdsFromParticipants(supabase, participantIds);
    const playerInMatch = await verifyPlayerInTeams(supabase, eventPlayerId, teamIds);
    if (!playerInMatch) {
      throw new BadRequestError('Player is not in this match');
    }
  }

  const isCompletedOrArchived = bracketMatch.status === 4 || bracketMatch.status === 5;
  if (isCompletedOrArchived) {
    if (eventConfig.status !== 'bracket') {
      throw new BadRequestError('Score corrections for completed matches are only allowed during the bracket phase');
    }
  } else {
    if (eventConfig.status !== 'bracket') {
      throw new BadRequestError('Scoring is only allowed during the bracket phase');
    }
  }

  if (bracketFrameCount === undefined || bracketFrameCount === null) {
    throw new InternalError('Event bracket frame count is missing');
  }
  const pointsEarned = calculatePoints(puttsMade, eventConfig.bonus_point_enabled);
  const isOvertime = frameNumber > bracketFrameCount;
  const frame = await getOrCreateFrameRepo(supabase, bracketMatchId, frameNumber, isOvertime);

  await upsertFrameResultAtomic(supabase, {
    matchFrameId: frame.id,
    eventPlayerId,
    bracketMatchId,
    puttsMade,
    pointsEarned,
  });

  if (bracketMatch.status === 2) { // Ready status
    await updateMatchStatus(supabase, bracketMatchId, 3); // Running status
  }

  return getBracketMatchWithDetails(eventId, bracketMatchId);
}


/**
 * Get bracket match with full details including teams and frames
 */
export async function getBracketMatchWithDetails(
  eventId: string,
  bracketMatchId: number
): Promise<BracketMatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  const [bracketMatch, bracketFrameCount] = await Promise.all([
    getMatchForScoringById(supabase, bracketMatchId),
    getEventBracketFrameCount(supabase, eventId),
  ]);

  if (!bracketMatch || bracketMatch.event_id !== eventId) {
    throw new NotFoundError('Bracket match not found');
  }

  if (bracketFrameCount === null) {
    throw new InternalError('Event scoring configuration not found');
  }

  const opponent1 = bracketMatch.opponent1 as OpponentData | null;
  const opponent2 = bracketMatch.opponent2 as OpponentData | null;

  const [team_one, team_two] = await Promise.all([
    getTeamFromParticipant(supabase, opponent1?.id ?? null),
    getTeamFromParticipant(supabase, opponent2?.id ?? null),
  ]);

  return {
    ...bracketMatch,
    opponent1,
    opponent2,
    team_one,
    team_two,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    frames: bracketMatch.frames?.sort((a: any, b: any) => a.frame_number - b.frame_number) || [],
    bracket_frame_count: bracketFrameCount,
  } as BracketMatchWithDetails;
}

/**
 * Create or get a frame for a bracket match
 */
export async function getOrCreateFrame(
  eventId: string,
  bracketMatchId: number,
  frameNumber: number,
  isOvertime: boolean
): Promise<MatchFrame> {
  const { supabase } = await requireEventAdmin(eventId);

  const bracketMatch = await getMatchByIdAndEvent(supabase, bracketMatchId, eventId);

  if (!bracketMatch) {
    throw new NotFoundError('Bracket match not found');
  }

  return getOrCreateFrameWithResults(supabase, bracketMatchId, frameNumber, isOvertime);
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

  const frame = await getFrameWithBracketMatch(supabase, matchFrameId);

  if (!frame || frame.bracket_match?.event_id !== eventId) {
    throw new NotFoundError('Frame not found');
  }

  if (input.putts_made < 0 || input.putts_made > 3) {
    throw new BadRequestError('Putts made must be between 0 and 3');
  }
  if (input.points_earned < 0 || input.points_earned > 4) {
    throw new BadRequestError('Points earned must be between 0 and 4');
  }

  return upsertFrameResult(supabase, {
    match_frame_id: matchFrameId,
    event_player_id: input.event_player_id,
    bracket_match_id: frame.bracket_match_id,
    putts_made: input.putts_made,
    points_earned: input.points_earned,
    order_in_frame: input.order_in_frame,
  });
}

/**
 * Record multiple frame results at once (for a full frame)
 */
export async function recordFullFrame(
  eventId: string,
  bracketMatchId: number,
  frameNumber: number,
  results: RecordFrameResultInput[],
  isOvertime: boolean
): Promise<MatchFrame> {
  const { supabase } = await requireEventAdmin(eventId);

  const frame = await getOrCreateFrame(eventId, bracketMatchId, frameNumber, isOvertime);

  for (const result of results) {
    await recordFrameResult(eventId, frame.id, result);
  }

  return getMatchFrame(supabase, frame.id);
}

/**
 * Complete a bracket match and update bracket progression
 */
export async function completeBracketMatch(
  eventId: string,
  bracketMatchId: number
): Promise<BracketMatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  const match = await getBracketMatchWithDetails(eventId, bracketMatchId);
  const score1 = match.opponent1?.score ?? 0;
  const score2 = match.opponent2?.score ?? 0;

  await completeMatch(supabase, eventId, bracketMatchId, {
    team1Score: score1,
    team2Score: score2,
  });

  try {
    await releaseMatchLaneAndReassign(eventId, bracketMatchId);
  } catch (laneError) {
    console.error('Failed to release lane and reassign:', laneError);
  }

  return getBracketMatchWithDetails(eventId, bracketMatchId);
}

/**
 * Complete a bracket match with final scores (no frame data)
 * This sets the scores, completes the match, and handles lane reassignment
 */
export async function completeMatchWithFinalScores(
  eventId: string,
  bracketMatchId: number,
  team1Score: number,
  team2Score: number
): Promise<BracketMatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  if (team1Score === team2Score) {
    throw new BadRequestError('Scores cannot be tied - there must be a winner');
  }

  await completeMatch(supabase, eventId, bracketMatchId, {
    team1Score,
    team2Score,
  });

  try {
    await releaseMatchLaneAndReassign(eventId, bracketMatchId);
  } catch (laneError) {
    console.error('Failed to release lane and reassign:', laneError);
  }

  return getBracketMatchWithDetails(eventId, bracketMatchId);
}

/**
 * Start a bracket match (set status to in_progress/Running)
 */
export async function startBracketMatch(
  eventId: string,
  bracketMatchId: number
): Promise<BracketMatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  const bracketMatch = await getMatchByIdAndEvent(supabase, bracketMatchId, eventId);

  if (!bracketMatch) {
    throw new NotFoundError('Bracket match not found');
  }

  await updateMatchStatus(supabase, bracketMatchId, 3); // Running status

  return getBracketMatchWithDetails(eventId, bracketMatchId);
}

/**
 * Correct scores on an already-completed match without re-triggering bracket progression.
 * Used for score corrections after a match has been completed.
 */
export async function correctMatchScores(
  eventId: string,
  bracketMatchId: number,
  team1Score: number,
  team2Score: number
): Promise<BracketMatchWithDetails> {
  const { supabase } = await requireEventAdmin(eventId);

  if (team1Score === team2Score) {
    throw new BadRequestError('Scores cannot be tied - there must be a winner');
  }

  const match = await getMatchWithOpponents(supabase, bracketMatchId, eventId);

  if (!match) {
    throw new NotFoundError('Bracket match not found');
  }

  const isCompleted = match.status === 4 || match.status === 5;
  if (!isCompleted) {
    throw new BadRequestError('Score correction is only valid for completed matches');
  }

  const team1Won = team1Score > team2Score;

  await updateMatchOpponentScores(
    supabase,
    bracketMatchId,
    {
      ...match.opponent1,
      score: team1Score,
      result: team1Won ? 'win' : 'loss',
    },
    {
      ...match.opponent2,
      score: team2Score,
      result: team1Won ? 'loss' : 'win',
    }
  );

  // Handle grand final reset match archiving/un-archiving if winner changed
  await handleGrandFinalCompletion(supabase, bracketMatchId, team1Won);

  return getBracketMatchWithDetails(eventId, bracketMatchId);
}

// Legacy aliases for backwards compatibility during migration
// These can be removed once all callers are updated
export const getMatchWithDetails = getBracketMatchWithDetails;
export { completeBracketMatch as completeMatchAdmin };
export const startMatch = startBracketMatch;
export type MatchWithDetails = BracketMatchWithDetails;
