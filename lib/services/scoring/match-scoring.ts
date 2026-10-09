import 'server-only';
import { requireEventAdmin } from '@/lib/services/event';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '@/lib/errors';
import { completeMatch, handleGrandFinalCompletionTx } from './match-completion';
import { recordFrameScores } from './score-submission';
import { lockEvent, lockMatch, withTransaction } from '@/lib/db/tx';
import { getTeamFromParticipant } from '@/lib/repositories/team-repository';
import {
  getOrCreateFrameWithResults,
  getFrameWithBracketMatch,
  upsertFrameResult,
} from '@/lib/repositories/frame-repository';
import { getMatchFrame } from '@/lib/repositories/frame-repository';
import { getEventScoringConfig, getEventBracketFrameCount } from '@/lib/repositories/event-repository';
import { getEventBracketConfig } from '@/lib/repositories/event-repository.db';
import { updateMatchOpponents } from '@/lib/repositories/bracket-repository.db';
import {
  getMatchByIdAndEvent,
  updateMatchStatus,
  getMatchForScoringById,
} from '@/lib/repositories/bracket-repository';
import { MatchStatus } from '@/lib/types/bracket';
import { WINNER_CHANGE_MESSAGE } from '@/lib/types/scoring';
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
  const { pg } = await requireEventAdmin(eventId);

  await recordFrameScores(pg, {
    eventId,
    matchId: bracketMatchId,
    frameNumber,
    scores: [{ event_player_id: eventPlayerId, putts_made: puttsMade }],
    scorer: 'admin',
  });

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

  const [bracketMatch, bracketFrameCount, eventConfig] = await Promise.all([
    getMatchForScoringById(supabase, bracketMatchId),
    getEventBracketFrameCount(supabase, eventId),
    getEventScoringConfig(supabase, eventId),
  ]);

  if (!bracketMatch || bracketMatch.event_id !== eventId) {
    throw new NotFoundError('Bracket match not found');
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
    ...bracketMatch,
    opponent1,
    opponent2,
    team_one,
    team_two,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    frames: bracketMatch.frames?.sort((a: any, b: any) => a.frame_number - b.frame_number) || [],
    bracket_frame_count: bracketFrameCount,
    bonus_point_enabled: eventConfig.bonus_point_enabled,
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
  const { pg } = await requireEventAdmin(eventId);

  // Result, bracket progression and lane release commit together.
  await completeMatch(pg, eventId, bracketMatchId);

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
  const { pg } = await requireEventAdmin(eventId);

  if (team1Score === team2Score) {
    throw new BadRequestError('Scores cannot be tied - there must be a winner');
  }

  await completeMatch(pg, eventId, bracketMatchId, { team1Score, team2Score });

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
  const { pg } = await requireEventAdmin(eventId);

  if (team1Score === team2Score) {
    throw new BadRequestError('Scores cannot be tied - there must be a winner');
  }

  const team1Won = team1Score > team2Score;

  await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    const event = await getEventBracketConfig(tx, eventId, { lock: 'share' });

    const match = await lockMatch(tx, bracketMatchId, eventId);
    if (!match) {
      throw new NotFoundError('Bracket match not found');
    }

    const isCompleted = match.status === MatchStatus.Completed || match.status === MatchStatus.Archived;
    if (!isCompleted) {
      throw new BadRequestError('Score correction is only valid for completed matches');
    }

    const opponent1 = match.opponent1 as OpponentData | null;
    const opponent2 = match.opponent2 as OpponentData | null;
    const hasTeam1Winner = opponent1?.result === 'win' && opponent2?.result === 'loss';
    const hasTeam2Winner = opponent1?.result === 'loss' && opponent2?.result === 'win';
    if (!hasTeam1Winner && !hasTeam2Winner) {
      throw new BadRequestError('This match has no recorded winner to correct. Use "Reset match" to replay it.');
    }
    if (team1Won !== hasTeam1Winner) {
      throw new BadRequestError(WINNER_CHANGE_MESSAGE);
    }

    const doubleGrandFinal = event?.double_grand_final ?? true;

    await updateMatchOpponents(
      tx,
      match,
      { ...(match.opponent1 as object), score: team1Score, result: team1Won ? 'win' : 'loss' },
      { ...(match.opponent2 as object), score: team2Score, result: team1Won ? 'loss' : 'win' }
    );

    // Reconcile the grand-final reset match in case its state was corrected separately.
    await handleGrandFinalCompletionTx(tx, eventId, bracketMatchId, team1Won, doubleGrandFinal);
  });

  return getBracketMatchWithDetails(eventId, bracketMatchId);
}

// Legacy aliases for backwards compatibility during migration
// These can be removed once all callers are updated
export const getMatchWithDetails = getBracketMatchWithDetails;
export { completeBracketMatch as completeMatchAdmin };
export const startMatch = startBracketMatch;
export type MatchWithDetails = BracketMatchWithDetails;
