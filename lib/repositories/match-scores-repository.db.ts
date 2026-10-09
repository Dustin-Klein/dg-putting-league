import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { bracket_match, bracket_participant, frame_results, team_members } from '@/lib/db/schema';

export interface MatchScoreSource {
  opponent1: unknown;
  opponent2: unknown;
  scoreOverride1: number | null;
  scoreOverride2: number | null;
}

export async function getMatchScoreSource(ex: Executor, matchId: number): Promise<MatchScoreSource | null> {
  const [row] = await ex
    .select({
      opponent1: bracket_match.opponent1,
      opponent2: bracket_match.opponent2,
      scoreOverride1: bracket_match.score_override_1,
      scoreOverride2: bracket_match.score_override_2,
    })
    .from(bracket_match)
    .where(eq(bracket_match.id, matchId));
  return row ?? null;
}

export async function getParticipantTeamIds(
  ex: Executor,
  participantIds: number[]
): Promise<Map<number, string | null>> {
  if (participantIds.length === 0) return new Map();
  const rows = await ex
    .select({ id: bracket_participant.id, teamId: bracket_participant.team_id })
    .from(bracket_participant)
    .where(inArray(bracket_participant.id, participantIds));
  return new Map(rows.map((row) => [row.id, row.teamId]));
}

export async function getFrameScoreSums(
  ex: Executor,
  matchId: number,
  teamIds: string[]
): Promise<{ resultCount: number; scores: Map<string, number> }> {
  const [countRow] = await ex
    .select({ count: sql<number>`count(*)::integer` })
    .from(frame_results)
    .where(eq(frame_results.bracket_match_id, matchId));

  if ((countRow?.count ?? 0) === 0 || teamIds.length === 0) {
    return { resultCount: countRow?.count ?? 0, scores: new Map() };
  }

  const rows = await ex
    .select({
      teamId: team_members.team_id,
      score: sql<number>`coalesce(sum(${frame_results.points_earned}), 0)::integer`,
    })
    .from(frame_results)
    .innerJoin(team_members, eq(team_members.event_player_id, frame_results.event_player_id))
    .where(and(eq(frame_results.bracket_match_id, matchId), inArray(team_members.team_id, teamIds)))
    .groupBy(team_members.team_id);

  return { resultCount: countRow?.count ?? 0, scores: new Map(rows.map((row) => [row.teamId, row.score])) };
}

export async function writeMatchScores(
  ex: Executor,
  matchId: number,
  opponent1: unknown,
  opponent2: unknown
): Promise<void> {
  await ex
    .update(bracket_match)
    .set({ opponent1, opponent2, updated_at: sql`clock_timestamp()` })
    .where(eq(bracket_match.id, matchId));
}

export async function setScoreOverride(
  ex: Executor,
  matchId: number,
  scores: { team1Score: number; team2Score: number },
  reason: string,
  userId: string | null
): Promise<void> {
  await ex
    .update(bracket_match)
    .set({
      score_override_1: scores.team1Score,
      score_override_2: scores.team2Score,
      score_override_reason: reason,
      score_override_by: userId,
    })
    .where(eq(bracket_match.id, matchId));
}

export async function clearScoreOverrides(ex: Executor, matchIds: number[]): Promise<void> {
  if (matchIds.length === 0) return;
  await ex
    .update(bracket_match)
    .set({
      score_override_1: null,
      score_override_2: null,
      score_override_reason: null,
      score_override_by: null,
    })
    .where(inArray(bracket_match.id, matchIds));
}
