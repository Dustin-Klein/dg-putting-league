import 'server-only';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { bracket_match, bracket_participant, frame_results, team_members } from '@/lib/db/schema';

export interface MatchScoreInputs {
  opponent1: unknown;
  opponent2: unknown;
  scoreOverride1: number | null;
  scoreOverride2: number | null;
  /** Teams behind the opponents' participants (null for an empty slot or unlinked participant). */
  team1Id: string | null;
  team2Id: string | null;
  /**
   * Frame results recorded for the match (every player), and each team's summed points.
   * Not read (null) when the match has a paired manual override.
   */
  resultCount: number | null;
  team1Points: number | null;
  team2Points: number | null;
}

/**
 * Everything a match's canonical score is computed from, in one statement: the match's
 * opponents and override, the opponents' teams, and the frame-result aggregates.
 */
export async function getMatchScoreInputs(ex: Executor, matchId: number): Promise<MatchScoreInputs | null> {
  const participantId = (opponent: SQL) =>
    sql`case when jsonb_typeof(${opponent}->'id') = 'number' then (${opponent}->>'id')::integer end`;
  const noOverride = sql`(m.score_override_1 is null or m.score_override_2 is null)`;
  const teamPoints = (teamId: SQL) => sql`case when ${noOverride} and ${teamId} is not null then (
      select coalesce(sum(fr.points_earned), 0)::integer
      from ${frame_results} fr
      join ${team_members} tm on tm.event_player_id = fr.event_player_id
      where fr.bracket_match_id = m.id and tm.team_id = ${teamId}
    ) end`;

  const rows = await ex.execute<{
    opponent1: unknown;
    opponent2: unknown;
    score_override_1: number | null;
    score_override_2: number | null;
    team1_id: string | null;
    team2_id: string | null;
    result_count: number | null;
    team1_points: number | null;
    team2_points: number | null;
  }>(sql`
    select
      m.opponent1, m.opponent2, m.score_override_1, m.score_override_2,
      p1.team_id as team1_id, p2.team_id as team2_id,
      case when ${noOverride} then (
        select count(*)::integer from ${frame_results} fr where fr.bracket_match_id = m.id
      ) end as result_count,
      ${teamPoints(sql`p1.team_id`)} as team1_points,
      ${teamPoints(sql`p2.team_id`)} as team2_points
    from ${bracket_match} m
    left join ${bracket_participant} p1 on p1.id = ${participantId(sql`m.opponent1`)}
    left join ${bracket_participant} p2 on p2.id = ${participantId(sql`m.opponent2`)}
    where m.id = ${matchId}`);

  const row = rows[0];
  if (!row) return null;
  return {
    opponent1: row.opponent1,
    opponent2: row.opponent2,
    scoreOverride1: row.score_override_1,
    scoreOverride2: row.score_override_2,
    team1Id: row.team1_id,
    team2Id: row.team2_id,
    resultCount: row.result_count,
    team1Points: row.team1_points,
    team2Points: row.team2_points,
  };
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
