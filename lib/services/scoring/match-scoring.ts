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
} from '@/lib/repositories/frame-repository';
import { getMatchFrame } from '@/lib/repositories/frame-repository';
import { getEventScoringConfig, getEventBracketFrameCount, getEventBracketConfig } from '@/lib/repositories/event-repository.db';
import {
  getMatchByIdAndEvent,
  updateMatchStatus,
  getMatchForScoringById,
} from '@/lib/repositories/bracket-repository';
import { MatchStatus } from '@/lib/types/bracket';
import { WINNER_CHANGE_MESSAGE } from '@/lib/types/scoring';
import { clearScoreOverrides, setScoreOverride } from '@/lib/repositories/match-scores-repository.db';
import { computeMatchScores, syncMatchScores } from './match-scores';
import type {
  BracketMatchWithDetails,
  OpponentData,
  MatchFrame,
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
  const { supabase, pg } = await requireEventAdmin(eventId);

  const [bracketMatch, bracketFrameCount, eventConfig] = await Promise.all([
    getMatchForScoringById(supabase, bracketMatchId),
    getEventBracketFrameCount(pg, eventId),
    getEventScoringConfig(pg, eventId),
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
    has_score_override:
      bracketMatch.score_override_1 !== null && bracketMatch.score_override_2 !== null,
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
 * Record multiple frame results at once (for a full frame)
 */
export async function recordFullFrame(
  eventId: string,
  bracketMatchId: number,
  frameNumber: number,
  results: RecordFrameResultInput[],
  isOvertime: boolean
): Promise<MatchFrame> {
  const { supabase, pg } = await requireEventAdmin(eventId);
  await recordFrameScores(pg, {
    eventId,
    matchId: bracketMatchId,
    frameNumber,
    scores: results.map((result) => ({
      event_player_id: result.event_player_id,
      putts_made: result.putts_made,
    })),
    scorer: 'admin',
  });
  const frame = await getOrCreateFrameWithResults(supabase, bracketMatchId, frameNumber, isOvertime);
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
  const { pg, user } = await requireEventAdmin(eventId);

  if (team1Score === team2Score) {
    throw new BadRequestError('Scores cannot be tied - there must be a winner');
  }

  await completeMatch(pg, eventId, bracketMatchId, { team1Score, team2Score }, { scoreOverrideBy: user.id });

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
  const { pg, user } = await requireEventAdmin(eventId);

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

    await setScoreOverride(
      tx,
      bracketMatchId,
      { team1Score, team2Score },
      'correction',
      user.id
    );
    await syncMatchScores(tx, bracketMatchId);

    // Reconcile the grand-final reset match in case its state was corrected separately.
    await handleGrandFinalCompletionTx(tx, eventId, bracketMatchId, team1Won, doubleGrandFinal);
  });

  return getBracketMatchWithDetails(eventId, bracketMatchId);
}

/** Clear a manual score and restore the score derived from frame results. */
export async function clearScoreOverride(
  eventId: string,
  bracketMatchId: number
): Promise<BracketMatchWithDetails> {
  const { pg } = await requireEventAdmin(eventId);

  await withTransaction(pg, async (tx) => {
    const event = await getEventBracketConfig(tx, eventId, { lock: 'share' });
    if (!event) throw new NotFoundError('Event not found');

    const match = await lockMatch(tx, bracketMatchId, eventId);
    if (!match) throw new NotFoundError('Bracket match not found');

    await clearScoreOverrides(tx, [bracketMatchId]);
    const frameScores = await computeMatchScores(tx, bracketMatchId);
    const opponent1 = match.opponent1 as OpponentData | null;
    const opponent2 = match.opponent2 as OpponentData | null;
    const recordedTeam1Winner =
      opponent1?.result === 'win' && opponent2?.result === 'loss'
        ? true
        : opponent1?.result === 'loss' && opponent2?.result === 'win'
          ? false
          : null;
    if (
      recordedTeam1Winner !== null &&
      (frameScores === null ||
        frameScores.team1Score === frameScores.team2Score ||
        (frameScores.team1Score > frameScores.team2Score) !== recordedTeam1Winner)
    ) {
      throw new BadRequestError(WINNER_CHANGE_MESSAGE);
    }
    await syncMatchScores(tx, bracketMatchId);
  });

  return getBracketMatchWithDetails(eventId, bracketMatchId);
}

// Legacy aliases for backwards compatibility during migration
// These can be removed once all callers are updated
export const getMatchWithDetails = getBracketMatchWithDetails;
export { completeBracketMatch as completeMatchAdmin };
export const startMatch = startBracketMatch;
export type MatchWithDetails = BracketMatchWithDetails;
