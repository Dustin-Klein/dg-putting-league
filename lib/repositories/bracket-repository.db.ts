import 'server-only';
import { and, asc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { Status } from 'brackets-model';
import type { Executor } from '@/lib/db/tx';
import {
  bracket_group,
  bracket_match,
  bracket_participant,
  bracket_round,
  bracket_stage,
  match_frames,
} from '@/lib/db/schema';
import { applyMatchWriteRules } from './bracket-storage.db';
import type {
  BracketResetContext,
  BracketResetContextMatch,
  BracketResetContextStage,
} from './bracket-repository';

export type MatchOpponent = { id?: number | null; position?: number; score?: number; result?: string } | null;

export async function getMatchOpponentScores(
  ex: Executor,
  matchId: number
): Promise<{ opponent1: MatchOpponent; opponent2: MatchOpponent } | null> {
  const rows = await ex
    .select({ opponent1: bracket_match.opponent1, opponent2: bracket_match.opponent2 })
    .from(bracket_match)
    .where(eq(bracket_match.id, matchId))
    .limit(1);
  if (!rows[0]) return null;
  return {
    opponent1: rows[0].opponent1 as MatchOpponent,
    opponent2: rows[0].opponent2 as MatchOpponent,
  };
}

export async function getStageForEvent(
  ex: Executor,
  eventId: string
): Promise<{ id: number } | null> {
  const rows = await ex
    .select({ id: bracket_stage.id })
    .from(bracket_stage)
    .where(eq(bracket_stage.tournament_id, eventId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getParticipantsForEvent(
  ex: Executor,
  eventId: string
): Promise<Array<{ id: number; team_id: string | null }>> {
  return ex
    .select({ id: bracket_participant.id, team_id: bracket_participant.team_id })
    .from(bracket_participant)
    .where(eq(bracket_participant.tournament_id, eventId))
    .orderBy(asc(bracket_participant.id));
}

export async function linkParticipantsToTeams(
  ex: Executor,
  eventId: string,
  mappings: Array<{ participantId: number; teamId: string }>
): Promise<void> {
  for (const { participantId, teamId } of mappings) {
    await ex
      .update(bracket_participant)
      .set({ team_id: teamId })
      .where(and(eq(bracket_participant.id, participantId), eq(bracket_participant.tournament_id, eventId)));
  }
}

export async function setEventIdOnMatches(ex: Executor, stageId: number, eventId: string): Promise<void> {
  await ex.update(bracket_match).set({ event_id: eventId }).where(eq(bracket_match.stage_id, stageId));
}

/**
 * Mark every not-yet-ready match whose two slots hold a participant as Ready.
 */
export async function setFilledMatchesReady(ex: Executor, stageId: number): Promise<void> {
  await ex
    .update(bracket_match)
    .set({ status: Status.Ready })
    .where(
      and(
        eq(bracket_match.stage_id, stageId),
        lt(bracket_match.status, Status.Ready),
        sql`${bracket_match.opponent1}->>'id' is not null`,
        sql`${bracket_match.opponent2}->>'id' is not null`
      )
    );
}

export interface MatchGroupInfo {
  id: number;
  group_id: number;
  round_number: number;
  group_number: number;
}

export async function getMatchGroupInfo(ex: Executor, matchId: number): Promise<MatchGroupInfo | null> {
  const rows = await ex
    .select({
      id: bracket_match.id,
      group_id: bracket_match.group_id,
      round_number: bracket_round.number,
      group_number: bracket_group.number,
    })
    .from(bracket_match)
    .innerJoin(bracket_round, eq(bracket_round.id, bracket_match.round_id))
    .innerJoin(bracket_group, eq(bracket_group.id, bracket_round.group_id))
    .where(eq(bracket_match.id, matchId));
  return rows[0] ?? null;
}

/**
 * The grand-final reset match: the match in the second round of the final group.
 */
export async function getSecondGrandFinalMatch(
  ex: Executor,
  groupId: number
): Promise<{ id: number; status: number; lane_id: string | null } | null> {
  const rounds = await ex
    .select({ id: bracket_round.id })
    .from(bracket_round)
    .where(eq(bracket_round.group_id, groupId))
    .orderBy(asc(bracket_round.number));
  if (rounds.length < 2) return null;

  const rows = await ex
    .select({ id: bracket_match.id, status: bracket_match.status, lane_id: bracket_match.lane_id })
    .from(bracket_match)
    .where(eq(bracket_match.round_id, rounds[1].id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateMatchStatus(ex: Executor, matchId: number, status: number): Promise<void> {
  await ex.update(bracket_match).set({ status }).where(eq(bracket_match.id, matchId));
}

function mergeOpponent(stored: MatchOpponent, incoming: MatchOpponent | undefined): MatchOpponent {
  if (incoming == null) return stored;
  if ('id' in incoming && incoming.id == null) return { id: null };
  if ('id' in incoming && String(stored?.id ?? '') !== String(incoming.id)) return incoming;
  return { ...(stored ?? {}), ...incoming };
}

/**
 * Write a match's opponents and status with merge semantics (manual advance/remove
 * and reset rewrites): a null opponent leaves that slot unchanged; `{ id: null }`
 * empties it; a different id replaces the slot; the same id merges fields.
 * Callers hold the event lock.
 */
export async function mergeMatchOpponents(
  ex: Executor,
  match: { id: number; opponent1: unknown; opponent2: unknown },
  opponent1: MatchOpponent,
  opponent2: MatchOpponent,
  status: number
): Promise<void> {
  const merged = {
    status,
    opponent1: mergeOpponent(match.opponent1 as MatchOpponent, opponent1),
    opponent2: mergeOpponent(match.opponent2 as MatchOpponent, opponent2),
  };
  const next = applyMatchWriteRules(match, merged);
  await ex
    .update(bracket_match)
    .set({
      status: next.status,
      opponent1: next.opponent1,
      opponent2: next.opponent2,
      updated_at: sql`clock_timestamp()`,
    })
    .where(eq(bracket_match.id, match.id));
}

/**
 * Empty every slot, drop lane assignments and set every match to Waiting.
 */
export async function clearAllMatchOpponents(ex: Executor, stageId: number): Promise<void> {
  await ex
    .update(bracket_match)
    .set({
      opponent1: { id: null },
      opponent2: { id: null },
      status: Status.Waiting,
      lane_id: null,
      lane_assigned_at: null,
    })
    .where(eq(bracket_match.stage_id, stageId));
}

export async function getBracketResetContext(
  ex: Executor,
  eventId: string
): Promise<BracketResetContext | null> {
  const [stage] = await ex
    .select({ id: bracket_stage.id, type: bracket_stage.type, settings: bracket_stage.settings })
    .from(bracket_stage)
    .where(eq(bracket_stage.tournament_id, eventId))
    .limit(1);
  if (!stage) return null;

  const [groups, rounds, matches] = await Promise.all([
    ex
      .select({ id: bracket_group.id, number: bracket_group.number })
      .from(bracket_group)
      .where(eq(bracket_group.stage_id, stage.id))
      .orderBy(asc(bracket_group.number)),
    ex
      .select({ id: bracket_round.id, group_id: bracket_round.group_id, number: bracket_round.number })
      .from(bracket_round)
      .where(eq(bracket_round.stage_id, stage.id))
      .orderBy(asc(bracket_round.group_id), asc(bracket_round.number)),
    ex
      .select({
        id: bracket_match.id,
        stage_id: bracket_match.stage_id,
        group_id: bracket_match.group_id,
        round_id: bracket_match.round_id,
        number: bracket_match.number,
        status: bracket_match.status,
        opponent1: bracket_match.opponent1,
        opponent2: bracket_match.opponent2,
        lane_id: bracket_match.lane_id,
      })
      .from(bracket_match)
      .where(and(eq(bracket_match.event_id, eventId), eq(bracket_match.stage_id, stage.id)))
      .orderBy(asc(bracket_match.round_id), asc(bracket_match.number)),
  ]);

  return {
    stage: stage as BracketResetContextStage,
    groups,
    rounds,
    matches: matches as BracketResetContextMatch[],
  };
}

/**
 * Delete the frames of the given matches (frame_results cascade).
 */
export async function deleteMatchFrames(ex: Executor, matchIds: number[]): Promise<void> {
  if (matchIds.length === 0) return;
  await ex.delete(match_frames).where(inArray(match_frames.bracket_match_id, matchIds));
}

export async function getMatchesWithLanes(
  ex: Executor,
  matchIds: number[]
): Promise<Array<{ id: number; lane_id: string }>> {
  if (matchIds.length === 0) return [];
  const rows = await ex
    .select({ id: bracket_match.id, lane_id: bracket_match.lane_id })
    .from(bracket_match)
    .where(and(inArray(bracket_match.id, matchIds), isNotNull(bracket_match.lane_id)));
  return rows as Array<{ id: number; lane_id: string }>;
}

/**
 * Id of the final group (grand final) of the event's double-elimination stage.
 */
export async function getGrandFinalGroupId(ex: Executor, eventId: string, groupNumber: number): Promise<number | null> {
  const rows = await ex
    .select({ id: bracket_group.id })
    .from(bracket_group)
    .innerJoin(bracket_stage, eq(bracket_stage.id, bracket_group.stage_id))
    .where(and(eq(bracket_stage.tournament_id, eventId), eq(bracket_group.number, groupNumber)))
    .limit(1);
  return rows[0]?.id ?? null;
}
