import 'server-only';
import type { Executor } from '@/lib/db/tx';
import { NotFoundError } from '@/lib/errors';
import * as scoreDb from '@/lib/repositories/match-scores-repository.db';

export interface ComputedMatchScores {
  team1Score: number;
  team2Score: number;
}

type Opponent = Record<string, unknown> | null;

export function applyScoresToOpponentJson(
  opponent1: unknown,
  opponent2: unknown,
  scores: ComputedMatchScores | null
): { opponent1: Opponent; opponent2: Opponent } {
  const update = (value: unknown, score: number | null): Opponent => {
    if (value === null) return null;
    const opponent = typeof value === 'object' ? { ...(value as Record<string, unknown>) } : {};
    if (score === null) delete opponent.score;
    else opponent.score = score;
    return opponent;
  };
  return {
    opponent1: update(opponent1, scores?.team1Score ?? null),
    opponent2: update(opponent2, scores?.team2Score ?? null),
  };
}

/** The canonical scores for a match's loaded score inputs (see `computeMatchScores`). */
function scoresFromInputs(inputs: scoreDb.MatchScoreInputs): ComputedMatchScores | null {
  if (inputs.scoreOverride1 !== null && inputs.scoreOverride2 !== null) {
    return { team1Score: inputs.scoreOverride1, team2Score: inputs.scoreOverride2 };
  }
  if (inputs.resultCount === 0) return null;
  if (inputs.team1Id === null || inputs.team2Id === null) return { team1Score: 0, team2Score: 0 };
  return { team1Score: inputs.team1Points ?? 0, team2Score: inputs.team2Points ?? 0 };
}

/**
 * A match's canonical scores: its paired manual override, otherwise frame results
 * summed by each opponent's team; null when it has neither (no `score` key).
 */
export async function computeMatchScores(ex: Executor, matchId: number): Promise<ComputedMatchScores | null> {
  const inputs = await scoreDb.getMatchScoreInputs(ex, matchId);
  if (!inputs) throw new NotFoundError('Match not found');
  return scoresFromInputs(inputs);
}

/**
 * Write a match's canonical scores into its opponent JSON (the sole application score
 * writer) and return them. One read and one write.
 */
export async function syncMatchScores(ex: Executor, matchId: number): Promise<ComputedMatchScores | null> {
  const inputs = await scoreDb.getMatchScoreInputs(ex, matchId);
  if (!inputs) throw new NotFoundError('Match not found');
  const scores = scoresFromInputs(inputs);
  const opponents = applyScoresToOpponentJson(inputs.opponent1, inputs.opponent2, scores);
  await scoreDb.writeMatchScores(ex, matchId, opponents.opponent1, opponents.opponent2);
  return scores;
}
