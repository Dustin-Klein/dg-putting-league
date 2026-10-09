import 'server-only';
import type { Executor } from '@/lib/db/tx';
import { NotFoundError } from '@/lib/errors';
import * as scoreDb from '@/lib/repositories/match-scores-repository.db';

export interface ComputedMatchScores {
  team1Score: number;
  team2Score: number;
}

type Opponent = Record<string, unknown> | null;

function opponentId(value: unknown): number | null {
  if (value === null || typeof value !== 'object') return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'number' ? id : null;
}

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

export async function computeMatchScores(ex: Executor, matchId: number): Promise<ComputedMatchScores | null> {
  const source = await scoreDb.getMatchScoreSource(ex, matchId);
  if (!source) throw new NotFoundError('Match not found');

  if (source.scoreOverride1 !== null && source.scoreOverride2 !== null) {
    return { team1Score: source.scoreOverride1, team2Score: source.scoreOverride2 };
  }

  const participant1 = opponentId(source.opponent1);
  const participant2 = opponentId(source.opponent2);
  const participantIds = [participant1, participant2].filter((id): id is number => id !== null);
  const teams = await scoreDb.getParticipantTeamIds(ex, participantIds);
  const team1 = participant1 === null ? null : teams.get(participant1) ?? null;
  const team2 = participant2 === null ? null : teams.get(participant2) ?? null;
  const teamIds = [team1, team2].filter((id): id is string => id !== null);
  const frameScores = await scoreDb.getFrameScoreSums(ex, matchId, teamIds);
  if (frameScores.resultCount === 0) return null;
  if (team1 === null || team2 === null) return { team1Score: 0, team2Score: 0 };

  return {
    team1Score: frameScores.scores.get(team1) ?? 0,
    team2Score: frameScores.scores.get(team2) ?? 0,
  };
}

export async function syncMatchScores(ex: Executor, matchId: number): Promise<ComputedMatchScores | null> {
  const source = await scoreDb.getMatchScoreSource(ex, matchId);
  if (!source) throw new NotFoundError('Match not found');
  const scores = await computeMatchScores(ex, matchId);
  const opponents = applyScoresToOpponentJson(source.opponent1, source.opponent2, scores);
  await scoreDb.writeMatchScores(ex, matchId, opponents.opponent1, opponents.opponent2);
  return scores;
}
