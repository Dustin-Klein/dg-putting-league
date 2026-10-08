import 'server-only';
import { BadRequestError, NotFoundError } from '@/lib/errors';
import { lockMatch, withTransaction, type Executor } from '@/lib/db/tx';
import { getEventBracketConfig } from '@/lib/repositories/event-repository.db';
import { updateMatchStatus } from '@/lib/repositories/bracket-repository.db';
import { getOrCreateFrameId, upsertFrameResults } from '@/lib/repositories/frame-repository.db';
import { getMembersOfTeams, getTeamIdsForParticipants } from '@/lib/repositories/team-repository.db';
import { MatchStatus } from '@/lib/types/bracket';
import { calculatePoints } from './points-calculator';

export const MAX_FRAME_NUMBER = 50;

export interface FrameScore {
  event_player_id: string;
  putts_made: number;
}

export interface RecordFrameScoresInput {
  eventId: string;
  matchId: number;
  frameNumber: number;
  scores: FrameScore[];
  /**
   * Public scorers may only score matches in play (Ready/Running). Admins may also
   * correct frames of other matches, including completed ones, during bracket play.
   */
  scorer: 'public' | 'admin';
}

function validateInput({ frameNumber, scores }: RecordFrameScoresInput): void {
  if (!Number.isInteger(frameNumber) || frameNumber < 1) {
    throw new BadRequestError('Frame number must be a positive integer');
  }
  if (frameNumber > MAX_FRAME_NUMBER) {
    throw new BadRequestError('Frame number exceeds maximum allowed limit');
  }
  for (const score of scores) {
    if (!Number.isInteger(score.putts_made) || score.putts_made < 0 || score.putts_made > 3) {
      throw new BadRequestError('Putts must be between 0 and 3');
    }
  }
  if (new Set(scores.map((s) => s.event_player_id)).size !== scores.length) {
    throw new BadRequestError('Each player can only be scored once per frame');
  }
}

/**
 * Record one frame's scores for a match in a single transaction.
 *
 * The match row is locked (`FOR UPDATE`) for the whole write, so a score can't land
 * after another device completed the match, and concurrent scorers of the same frame
 * get consistent `order_in_frame` values. The frame_results trigger recomputes the
 * match score inside the same transaction.
 *
 * Callers authorize first (access code or event admin). Returns the match status
 * after the write.
 */
export async function recordFrameScores(
  ex: Executor,
  input: RecordFrameScoresInput
): Promise<{ status: number }> {
  validateInput(input);
  const { eventId, matchId, frameNumber, scores, scorer } = input;

  return withTransaction(ex, async (tx) => {
    const event = await getEventBracketConfig(tx, eventId);
    if (!event) {
      throw new NotFoundError('Event not found');
    }
    if (event.status !== 'bracket') {
      throw new BadRequestError('Scoring is only allowed during the bracket phase');
    }

    const match = await lockMatch(tx, matchId, eventId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    if (scorer === 'public') {
      if (match.status === MatchStatus.Completed || match.status === MatchStatus.Archived) {
        throw new BadRequestError('Match is already completed');
      }
      if (match.status !== MatchStatus.Ready && match.status !== MatchStatus.Running) {
        throw new BadRequestError('Match is not ready for scoring');
      }
    }

    const participantIds = [match.opponent1, match.opponent2]
      .map((o) => (o as { id?: number | null } | null)?.id)
      .filter((id): id is number => id != null);
    if (participantIds.length === 0) {
      throw new BadRequestError('Match has no participants yet');
    }

    const teamIds = await getTeamIdsForParticipants(tx, eventId, participantIds);
    if (teamIds.length === 0) {
      throw new BadRequestError('Match teams not found');
    }

    const playerIds = scores.map((s) => s.event_player_id);
    const members = await getMembersOfTeams(tx, playerIds, teamIds);
    if (!playerIds.every((id) => members.has(id))) {
      throw new BadRequestError(
        scores.length === 1 ? 'Player is not in this match' : 'One or more players are not in this match'
      );
    }

    const frameId = await getOrCreateFrameId(tx, matchId, frameNumber, frameNumber > event.bracket_frame_count);
    await upsertFrameResults(
      tx,
      frameId,
      matchId,
      scores.map((s) => ({
        event_player_id: s.event_player_id,
        putts_made: s.putts_made,
        points_earned: calculatePoints(s.putts_made, event.bonus_point_enabled),
      }))
    );

    if (match.status === MatchStatus.Ready && scores.length > 0) {
      await updateMatchStatus(tx, matchId, MatchStatus.Running);
      return { status: MatchStatus.Running };
    }
    return { status: match.status };
  });
}
