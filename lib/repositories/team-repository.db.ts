import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { chunks } from '@/lib/db/batch';
import type { PaymentType } from '@/lib/types/player';
import {
  bracket_participant,
  event_players,
  frame_results,
  player_profiles,
  players,
  qualification_frames,
  team_member_substitutions,
  team_members,
  teams,
} from '@/lib/db/schema';
import { toIsoTimestamp, toNumber } from '@/lib/db/mappers';
import type { Team } from '@/lib/types/team';

export interface TeamData {
  id: string;
  seed: number;
  pool_combo: string;
}

export interface TeamPlayerInfo {
  event_player_id: string;
  slot: number;
  pool: 'A' | 'B' | null;
  zone: number | null;
  putt_distance_ft: number;
  player: { id: string; full_name: string; nickname: string | null };
}

export interface TeamWithPlayers extends TeamData {
  players: TeamPlayerInfo[];
}

export interface PublicTeamPlayerInfo {
  event_player_id: string;
  slot: number;
  pool: 'A' | 'B' | null;
  zone: number | null;
  putt_distance_ft: number;
  full_name: string;
  nickname: string | null;
}

export interface PublicTeamWithPlayers extends TeamData {
  players: PublicTeamPlayerInfo[];
}

type ParticipantTeamRow = {
  participant_id: number;
  team_id: string;
  seed: number | null;
  pool_combo: string | null;
  event_player_id: string | null;
  slot: number | null;
  pool: 'A' | 'B' | null;
  zone: number | null;
  putt_distance_ft: string | null;
  player_id: string | null;
  full_name: string | null;
  nickname: string | null;
};

async function getParticipantTeamRows(
  ex: Executor,
  eventId: string,
  participantIds: number[]
): Promise<ParticipantTeamRow[]> {
  if (participantIds.length === 0) return [];
  return ex
    .select({
      participant_id: bracket_participant.id,
      team_id: teams.id,
      seed: teams.seed,
      pool_combo: teams.pool_combo,
      event_player_id: team_members.event_player_id,
      slot: team_members.slot,
      pool: event_players.pool,
      zone: event_players.zone,
      putt_distance_ft: event_players.putt_distance_ft,
      player_id: players.id,
      full_name: players.full_name,
      nickname: players.nickname,
    })
    .from(bracket_participant)
    .innerJoin(teams, eq(teams.id, bracket_participant.team_id))
    .leftJoin(team_members, eq(team_members.team_id, teams.id))
    .leftJoin(event_players, eq(event_players.id, team_members.event_player_id))
    .leftJoin(players, eq(players.id, event_players.player_id))
    .where(
      and(
        eq(bracket_participant.tournament_id, eventId),
        eq(teams.event_id, eventId),
        inArray(bracket_participant.id, participantIds)
      )
    )
    .orderBy(asc(bracket_participant.id), asc(team_members.slot));
}

/** All requested participant teams in one joined query, keyed by participant id. */
export async function getTeamsByParticipantIds(
  ex: Executor,
  eventId: string,
  participantIds: number[]
): Promise<Map<number, TeamWithPlayers>> {
  const result = new Map<number, TeamWithPlayers>();
  for (const row of await getParticipantTeamRows(ex, eventId, [...new Set(participantIds)])) {
    let team = result.get(row.participant_id);
    if (!team) {
      team = { id: row.team_id, seed: row.seed ?? 0, pool_combo: row.pool_combo ?? '', players: [] };
      result.set(row.participant_id, team);
    }
    if (row.event_player_id && row.slot !== null && row.player_id && row.full_name !== null) {
      team.players.push({
        event_player_id: row.event_player_id,
        slot: row.slot,
        pool: row.pool,
        zone: row.zone,
        putt_distance_ft: toNumber(row.putt_distance_ft ?? '0'),
        player: { id: row.player_id, full_name: row.full_name, nickname: row.nickname },
      });
    }
  }
  return result;
}

/** Public variant deliberately omits player id, payment type, and email. */
export async function getPublicTeamsByParticipantIds(
  ex: Executor,
  eventId: string,
  participantIds: number[]
): Promise<Map<number, PublicTeamWithPlayers>> {
  const result = new Map<number, PublicTeamWithPlayers>();
  for (const row of await getParticipantTeamRows(ex, eventId, [...new Set(participantIds)])) {
    let team = result.get(row.participant_id);
    if (!team) {
      team = { id: row.team_id, seed: row.seed ?? 0, pool_combo: row.pool_combo ?? '', players: [] };
      result.set(row.participant_id, team);
    }
    if (row.event_player_id && row.slot !== null) {
      team.players.push({
        event_player_id: row.event_player_id,
        slot: row.slot,
        pool: row.pool,
        zone: row.zone,
        putt_distance_ft: toNumber(row.putt_distance_ft ?? '0'),
        full_name: row.full_name ?? 'Unknown',
        nickname: row.nickname,
      });
    }
  }
  return result;
}

export async function getTeamFromParticipant(
  ex: Executor,
  eventId: string,
  participantId: number | null
): Promise<TeamWithPlayers | null> {
  if (!participantId) return null;
  return (await getTeamsByParticipantIds(ex, eventId, [participantId])).get(participantId) ?? null;
}

export async function getPublicTeamFromParticipant(
  ex: Executor,
  eventId: string,
  participantId: number | null
): Promise<PublicTeamWithPlayers | null> {
  if (!participantId) return null;
  return (await getPublicTeamsByParticipantIds(ex, eventId, [participantId])).get(participantId) ?? null;
}

export async function getFullTeamsForEvent(ex: Executor, eventId: string, includePaymentType = true): Promise<Team[]> {
  const rows = await ex
    .select({
      team_id: teams.id,
      event_id: teams.event_id,
      seed: teams.seed,
      pool_combo: teams.pool_combo,
      team_created_at: teams.created_at,
      event_player_id: event_players.id,
      player_id: event_players.player_id,
      payment_type: event_players.payment_type,
      pool: event_players.pool,
      pfa_score: event_players.pfa_score,
      scoring_method: event_players.scoring_method,
      event_player_created_at: event_players.created_at,
      slot: team_members.slot,
      joined_at: team_members.joined_at,
      player_number: players.player_number,
      full_name: players.full_name,
      nickname: players.nickname,
      player_created_at: players.created_at,
      default_pool: player_profiles.default_pool,
    })
    .from(teams)
    .leftJoin(team_members, eq(team_members.team_id, teams.id))
    .leftJoin(event_players, eq(event_players.id, team_members.event_player_id))
    .leftJoin(players, eq(players.id, event_players.player_id))
    .leftJoin(player_profiles, eq(player_profiles.player_id, players.id))
    .where(eq(teams.event_id, eventId))
    .orderBy(asc(teams.seed), asc(team_members.slot));

  const grouped = new Map<string, Team>();
  for (const row of rows) {
    let team = grouped.get(row.team_id);
    if (!team) {
      team = {
        id: row.team_id,
        event_id: row.event_id,
        seed: row.seed ?? 0,
        pool_combo: row.pool_combo ?? '',
        created_at: toIsoTimestamp(row.team_created_at),
        team_members: [],
      };
      grouped.set(row.team_id, team);
    }
    if (
      row.event_player_id &&
      row.player_id &&
      row.slot !== null &&
      row.joined_at &&
      row.full_name !== null &&
      row.player_created_at
    ) {
      team.team_members.push({
        team_id: row.team_id,
        event_player_id: row.event_player_id,
        slot: row.slot,
        joined_at: toIsoTimestamp(row.joined_at),
        event_player: {
          id: row.event_player_id,
          event_id: row.event_id,
          player_id: row.player_id,
          ...(includePaymentType ? { payment_type: row.payment_type as PaymentType | null } : { payment_type: null }),
          pool: row.pool,
          pfa_score: toNumber(row.pfa_score),
          scoring_method: row.scoring_method as 'qualification' | 'pfa' | 'default' | null,
          created_at: toIsoTimestamp(row.event_player_created_at!),
          player: {
            id: row.player_id,
            player_number: row.player_number,
            full_name: row.full_name,
            nickname: row.nickname,
            created_at: toIsoTimestamp(row.player_created_at),
            default_pool: row.default_pool,
          },
        },
      });
    }
  }
  return [...grouped.values()];
}

export async function getPublicTeamsForEvent(ex: Executor, eventId: string): Promise<Team[]> {
  const full = await getFullTeamsForEvent(ex, eventId, false);
  return full.map((team) => ({
    ...team,
    team_members: team.team_members.map((member) => {
      const { payment_type: _paymentType, ...eventPlayer } = member.event_player;
      void _paymentType;
      return { ...member, event_player: eventPlayer };
    }),
  })) as Team[];
}

/**
 * Team ids for bracket participants of one event.
 */
export async function getTeamIdsForParticipants(
  ex: Executor,
  eventId: string,
  participantIds: number[]
): Promise<string[]> {
  if (participantIds.length === 0) return [];
  const rows = await ex
    .select({ team_id: bracket_participant.team_id })
    .from(bracket_participant)
    .where(and(inArray(bracket_participant.id, participantIds), eq(bracket_participant.tournament_id, eventId)));
  return rows.map((r) => r.team_id).filter((id): id is string => id !== null);
}

/**
 * Which of the given event players belong to one of the given teams.
 */
export async function getMembersOfTeams(
  ex: Executor,
  eventPlayerIds: string[],
  teamIds: string[]
): Promise<Set<string>> {
  if (eventPlayerIds.length === 0 || teamIds.length === 0) return new Set();
  const rows = await ex
    .select({ event_player_id: team_members.event_player_id })
    .from(team_members)
    .where(and(inArray(team_members.team_id, teamIds), inArray(team_members.event_player_id, eventPlayerIds)));
  return new Set(rows.map((r) => r.event_player_id));
}

/** Player ids (not event_player ids) of the given teams' members, in one event. */
export async function getPlayerIdsOfTeams(ex: Executor, eventId: string, teamIds: string[]): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const rows = await ex
    .selectDistinct({ player_id: event_players.player_id })
    .from(team_members)
    .innerJoin(teams, eq(teams.id, team_members.team_id))
    .innerJoin(event_players, eq(event_players.id, team_members.event_player_id))
    .where(and(eq(teams.event_id, eventId), eq(event_players.event_id, eventId), inArray(teams.id, teamIds)));
  return rows.map((row) => row.player_id);
}

export async function getTeamMemberIds(ex: Executor, teamIds: string[]): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const rows = await ex
    .select({ event_player_id: team_members.event_player_id })
    .from(team_members)
    .where(inArray(team_members.team_id, teamIds));
  return rows.map((row) => row.event_player_id);
}

export interface NewTeam {
  seed: number;
  pool_combo: string;
  members: Array<{ event_player_id: string; role: 'A_pool' | 'B_pool' | null; slot: number }>;
}

/**
 * Insert teams and their members (one statement per table and chunk). Ids are
 * generated here, so the result is in input order without relying on RETURNING order.
 */
export async function insertTeamsWithMembers(
  ex: Executor,
  eventId: string,
  newTeams: NewTeam[]
): Promise<Array<{ id: string; seed: number | null; pool_combo: string | null }>> {
  const inserted = newTeams.map((t) => ({ id: randomUUID(), seed: t.seed, pool_combo: t.pool_combo }));
  for (const batch of chunks(inserted)) {
    await ex.insert(teams).values(batch.map((t) => ({ ...t, event_id: eventId })));
  }

  const members = newTeams.flatMap((t, i) =>
    t.members.map((m) => ({ team_id: inserted[i].id, event_player_id: m.event_player_id, role: m.role, slot: m.slot }))
  );
  for (const batch of chunks(members)) {
    await ex.insert(team_members).values(batch);
  }

  return inserted;
}

/**
 * Teams of an event for bracket seeding.
 */
export async function getTeamsForSeeding(
  ex: Executor,
  eventId: string
): Promise<Array<{ id: string; seed: number | null; pool_combo: string | null }>> {
  return ex
    .select({ id: teams.id, seed: teams.seed, pool_combo: teams.pool_combo })
    .from(teams)
    .where(eq(teams.event_id, eventId));
}

export interface TeamMemberRow {
  team_id: string;
  event_player_id: string;
  player_id: string;
  slot: number;
  role: string | null;
  pool: 'A' | 'B' | null;
}

/** Members of one of the event's teams, in slot order. */
export async function getTeamMembersInEvent(ex: Executor, eventId: string, teamId: string): Promise<TeamMemberRow[]> {
  return ex
    .select({
      team_id: team_members.team_id,
      event_player_id: team_members.event_player_id,
      player_id: event_players.player_id,
      slot: team_members.slot,
      role: team_members.role,
      pool: event_players.pool,
    })
    .from(team_members)
    .innerJoin(teams, eq(teams.id, team_members.team_id))
    .innerJoin(event_players, eq(event_players.id, team_members.event_player_id))
    .where(and(eq(teams.id, teamId), eq(teams.event_id, eventId), eq(event_players.event_id, eventId)))
    .orderBy(asc(team_members.slot));
}

/** The bracket participant id of one of the event's teams, or null before the bracket exists. */
export async function getParticipantIdForTeam(ex: Executor, eventId: string, teamId: string): Promise<number | null> {
  const [row] = await ex
    .select({ id: bracket_participant.id })
    .from(bracket_participant)
    .where(and(eq(bracket_participant.tournament_id, eventId), eq(bracket_participant.team_id, teamId)))
    .limit(1);
  return row?.id ?? null;
}

/** Whether the event entry is on any team. */
export async function isEntryOnTeam(ex: Executor, eventPlayerId: string): Promise<boolean> {
  const [row] = await ex
    .select({ n: count() })
    .from(team_members)
    .where(eq(team_members.event_player_id, eventPlayerId));
  return (row?.n ?? 0) > 0;
}

/** Frames recorded for an entry anywhere (bracket matches and qualification). */
export async function countEntryFrames(ex: Executor, eventPlayerId: string): Promise<number> {
  const [[bracket], [qualification]] = await Promise.all([
    ex.select({ n: count() }).from(frame_results).where(eq(frame_results.event_player_id, eventPlayerId)),
    ex.select({ n: count() }).from(qualification_frames).where(eq(qualification_frames.event_player_id, eventPlayerId)),
  ]);
  return (bracket?.n ?? 0) + (qualification?.n ?? 0);
}

/** Put `inEventPlayerId` in the slot `outEventPlayerId` holds on the team, with the same role. */
export async function replaceTeamMember(
  ex: Executor,
  teamId: string,
  outEventPlayerId: string,
  inEventPlayerId: string
): Promise<void> {
  const updated = await ex
    .update(team_members)
    .set({ event_player_id: inEventPlayerId, joined_at: sql`now()` })
    .where(and(eq(team_members.team_id, teamId), eq(team_members.event_player_id, outEventPlayerId)))
    .returning({ team_id: team_members.team_id });
  if (updated.length !== 1) throw new Error('Team member to replace not found');
}

export type SubstitutionReason = 'missed_registration' | 'left_early' | 'injury' | 'wrong_player';

export async function insertSubstitution(
  ex: Executor,
  row: {
    event_id: string;
    team_id: string;
    slot: number;
    out_player_id: string;
    out_event_player_id: string | null;
    in_event_player_id: string;
    reason: SubstitutionReason;
    created_by: string | null;
  }
): Promise<void> {
  await ex.insert(team_member_substitutions).values(row);
}

/** Whether the player was subbed out of the event (they can't come back into its bracket). */
export async function wasSubbedOut(ex: Executor, eventId: string, playerId: string): Promise<boolean> {
  const [row] = await ex
    .select({ n: count() })
    .from(team_member_substitutions)
    .where(and(eq(team_member_substitutions.event_id, eventId), eq(team_member_substitutions.out_player_id, playerId)));
  return (row?.n ?? 0) > 0;
}

/** Delete every team of the event (members, placements and substitutions cascade). */
export async function deleteTeamsForEvent(ex: Executor, eventId: string): Promise<void> {
  await ex.delete(teams).where(eq(teams.event_id, eventId));
}

/**
 * Rename a team (and its bracket participant) from its current members, in slot order,
 * e.g. after a substitution. Returns the new name.
 */
export async function renameTeamFromMembers(ex: Executor, eventId: string, teamId: string): Promise<string> {
  const rows = await ex
    .select({ name: players.full_name })
    .from(team_members)
    .innerJoin(event_players, eq(event_players.id, team_members.event_player_id))
    .innerJoin(players, eq(players.id, event_players.player_id))
    .where(eq(team_members.team_id, teamId))
    .orderBy(asc(team_members.slot));
  const name = rows.map((row) => row.name).join(' & ');
  await ex.update(teams).set({ pool_combo: name }).where(and(eq(teams.id, teamId), eq(teams.event_id, eventId)));
  await ex
    .update(bracket_participant)
    .set({ name })
    .where(and(eq(bracket_participant.team_id, teamId), eq(bracket_participant.tournament_id, eventId)));
  return name;
}
