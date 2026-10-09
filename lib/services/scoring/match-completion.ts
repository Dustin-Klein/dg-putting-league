import 'server-only';
import { BracketsManager } from 'brackets-manager';
import { lockEvent, lockMatch, withTransaction, type Executor, type Tx } from '@/lib/db/tx';
import { DrizzleBracketStorage } from '@/lib/repositories/bracket-storage.db';
import {
  getMatchGroupInfo,
  getSecondGrandFinalMatch,
  updateMatchStatus,
} from '@/lib/repositories/bracket-repository.db';
import { getRegulationFrameResults } from '@/lib/repositories/frame-repository.db';
import { getTeamIdsForParticipants, getTeamMemberIds } from '@/lib/repositories/team-repository.db';
import { releaseMatchLane } from '@/lib/repositories/lane-repository.db';
import { getEventBracketConfig } from '@/lib/repositories/event-repository.db';
import { releaseLaneAndAutoAssignTx } from '@/lib/services/lane';
import { MatchStatus } from '@/lib/types/bracket';
import { BadRequestError, InternalError, NotFoundError } from '@/lib/errors';
import type { MatchScores } from '@/lib/types/scoring';
import { setScoreOverride } from '@/lib/repositories/match-scores-repository.db';
import { computeMatchScores, syncMatchScores } from './match-scores';

export type { MatchScores } from '@/lib/types/scoring';

type OpponentJson = { id?: number | null; score?: number } | null;

export interface CompleteMatchOptions {
  requireRegulationFrames?: boolean;
  scoreOverrideBy?: string;
}

/**
 * Complete a bracket match inside the caller's transaction, which must hold the event
 * lock: record the result, advance winner and loser (brackets-manager), settle the
 * grand-final reset match, release the match's lane and hand free lanes to the next
 * matches. Either all of it commits or none of it does.
 *
 * Without `scores`, frame-derived scores decide the result.
 */
export async function completeMatchTx(
  tx: Tx,
  eventId: string,
  matchId: number,
  scores?: MatchScores,
  options: CompleteMatchOptions = {}
): Promise<void> {
  const event = await getEventBracketConfig(tx, eventId, { lock: 'share' });
  if (!event) {
    throw new NotFoundError('Event not found');
  }
  if (event.status !== 'bracket') {
    throw new BadRequestError('Event is not in bracket play');
  }

  const match = await lockMatch(tx, matchId, eventId);
  if (!match) {
    throw new NotFoundError('Match not found');
  }
  if (match.status === MatchStatus.Completed || match.status === MatchStatus.Archived) {
    throw new BadRequestError('Match is already completed');
  }

  const opponent1 = match.opponent1 as OpponentJson;
  const opponent2 = match.opponent2 as OpponentJson;
  if (opponent1?.id == null || opponent2?.id == null) {
    throw new BadRequestError('Match has no participants yet');
  }

  if (options.requireRegulationFrames) {
    const teamIds = await getTeamIdsForParticipants(tx, eventId, [opponent1.id, opponent2.id]);
    const playerIds = await getTeamMemberIds(tx, teamIds);
    const results = await getRegulationFrameResults(tx, matchId, event.bracket_frame_count, playerIds);
    const scored = new Set(results.map((result) => `${result.frame_number}:${result.event_player_id}`));
    const allRegulationFramesScored =
      teamIds.length === 2 &&
      new Set(teamIds).size === 2 &&
      playerIds.length > 0 &&
      playerIds.every((playerId) =>
        Array.from({ length: event.bracket_frame_count }, (_, index) => index + 1).every((frameNumber) =>
          scored.has(`${frameNumber}:${playerId}`)
        )
      );
    if (!allRegulationFramesScored) {
      throw new BadRequestError(
        `All players must be scored for frames 1–${event.bracket_frame_count} before completing the match`
      );
    }
  }

  if (scores) {
    await setScoreOverride(tx, matchId, scores, 'final score entered', options.scoreOverrideBy ?? null);
    await syncMatchScores(tx, matchId);
  }
  const computedScores = await computeMatchScores(tx, matchId);
  const team1Score = computedScores?.team1Score ?? 0;
  const team2Score = computedScores?.team2Score ?? 0;
  if (team1Score === team2Score) {
    throw new BadRequestError(
      scores
        ? 'Match cannot be completed with a tied score'
        : 'Match cannot be completed with a tied score. Continue scoring in overtime.'
    );
  }
  const team1Won = team1Score > team2Score;

  const manager = new BracketsManager(new DrizzleBracketStorage(tx, eventId));
  try {
    await manager.update.match({
      id: matchId,
      opponent1: { score: team1Score, result: team1Won ? 'win' : 'loss' },
      opponent2: { score: team2Score, result: team1Won ? 'loss' : 'win' },
    });
  } catch (error) {
    if (error instanceof InternalError) throw error;
    throw new InternalError(`Failed to complete match: ${error instanceof Error ? error.message : String(error)}`);
  }
  await syncMatchScores(tx, matchId);

  await handleGrandFinalCompletionTx(tx, eventId, matchId, team1Won, event.double_grand_final);
  await releaseLaneAndAutoAssignTx(tx, eventId, matchId);
}

/**
 * Complete a match in its own transaction (see `completeMatchTx`).
 * Callers authorize first (access code or event admin).
 */
export async function completeMatch(
  ex: Executor,
  eventId: string,
  matchId: number,
  scores?: MatchScores,
  options: CompleteMatchOptions = {}
): Promise<void> {
  await withTransaction(ex, async (tx) => {
    await lockEvent(tx, eventId);
    await completeMatchTx(tx, eventId, matchId, scores, options);
  });
}

const GRAND_FINAL_GROUP_NUMBER = 3;
const FIRST_GF_ROUND_NUMBER = 1;

/**
 * Handle grand final completion: manage the second grand final (reset match)
 * based on the outcome of the first grand final match.
 *
 * In double elimination grand finals:
 * - opponent1 is the WB champion (0 losses)
 * - opponent2 is the LB champion (1 loss)
 * - If opponent1 wins → tournament over, archive reset match
 * - If opponent2 wins → reset match is needed, ensure it's Ready
 *
 * This function handles both initial completion and score corrections. Runs in the
 * caller's transaction, which must hold the event lock.
 */
export async function handleGrandFinalCompletionTx(
  tx: Tx,
  eventId: string,
  completedMatchId: number,
  opponent1Won: boolean,
  doubleGrandFinal: boolean = true
): Promise<void> {
  const match = await getMatchGroupInfo(tx, completedMatchId);
  if (!match) return;

  if (match.group_number !== GRAND_FINAL_GROUP_NUMBER) return;
  if (match.round_number !== FIRST_GF_ROUND_NUMBER) return;

  // This is the first grand final match - find the reset match
  const secondGFMatch = await getSecondGrandFinalMatch(tx, match.group_id);
  if (!secondGFMatch) return;

  if (opponent1Won) {
    // WB champion won - archive the reset match if not already archived
    if (secondGFMatch.status !== MatchStatus.Archived) {
      if (secondGFMatch.lane_id) {
        await releaseMatchLane(tx, eventId, secondGFMatch.id);
      }
      await updateMatchStatus(tx, secondGFMatch.id, MatchStatus.Archived);
    }
  } else {
    // LB champion won - ensure the reset match is playable (only when double GF is enabled)
    if (doubleGrandFinal && secondGFMatch.status === MatchStatus.Archived) {
      await updateMatchStatus(tx, secondGFMatch.id, MatchStatus.Ready);
    }
  }
}
