import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { bracket_participant, event_players, players, team_members, teams } from '@/lib/db/schema';
import { toIsoTimestamp, toNumber } from '@/lib/db/mappers';
import type { Team } from '@/lib/types/team';

export interface TeamData {
  id: string;
  seed: number;
  pool_combo: string;
}

export interface TeamPlayerInfo {
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
  player: { id: string; full_name: string; nickname: string | null };
}

export interface TeamWithPlayers extends TeamData {
  players: TeamPlayerInfo[];
}

export interface PublicTeamPlayerInfo {
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
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
  role: string | null;
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
      role: team_members.role,
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
    .orderBy(asc(bracket_participant.id), asc(team_members.joined_at));
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
    if (row.event_player_id && row.role && row.player_id && row.full_name !== null) {
      team.players.push({
        event_player_id: row.event_player_id,
        role: row.role as 'A_pool' | 'B_pool',
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
    if (row.event_player_id && row.role) {
      team.players.push({
        event_player_id: row.event_player_id,
        role: row.role as 'A_pool' | 'B_pool',
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

export async function getTeamsForEvent(ex: Executor, eventId: string): Promise<Array<{ id: string }>> {
  return ex.select({ id: teams.id }).from(teams).where(eq(teams.event_id, eventId));
}

export async function getTeamsWithMembersForEvent(
  ex: Executor,
  eventId: string
): Promise<Array<{ id: string; team_members: Array<{ event_player_id: string }> }>> {
  const rows = await ex
    .select({ id: teams.id, event_player_id: team_members.event_player_id })
    .from(teams)
    .leftJoin(team_members, eq(team_members.team_id, teams.id))
    .where(eq(teams.event_id, eventId));
  const grouped = new Map<string, { id: string; team_members: Array<{ event_player_id: string }> }>();
  for (const row of rows) {
    const team = grouped.get(row.id) ?? { id: row.id, team_members: [] };
    if (row.event_player_id) team.team_members.push({ event_player_id: row.event_player_id });
    grouped.set(row.id, team);
  }
  return [...grouped.values()];
}

export async function updateTeamSeed(ex: Executor, teamId: string, seed: number): Promise<void> {
  await ex.update(teams).set({ seed }).where(eq(teams.id, teamId));
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
      role: team_members.role,
      joined_at: team_members.joined_at,
      player_number: players.player_number,
      full_name: players.full_name,
      nickname: players.nickname,
      player_created_at: players.created_at,
      default_pool: players.default_pool,
    })
    .from(teams)
    .leftJoin(team_members, eq(team_members.team_id, teams.id))
    .leftJoin(event_players, eq(event_players.id, team_members.event_player_id))
    .leftJoin(players, eq(players.id, event_players.player_id))
    .where(eq(teams.event_id, eventId))
    .orderBy(asc(teams.seed), asc(team_members.joined_at));

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
      row.role &&
      row.joined_at &&
      row.full_name !== null &&
      row.player_created_at
    ) {
      team.team_members.push({
        team_id: row.team_id,
        event_player_id: row.event_player_id,
        role: row.role as 'A_pool' | 'B_pool' | 'alternate',
        joined_at: toIsoTimestamp(row.joined_at),
        event_player: {
          id: row.event_player_id,
          event_id: row.event_id,
          player_id: row.player_id,
          ...(includePaymentType ? { payment_type: row.payment_type as 'cash' | 'electronic' | null } : { payment_type: null }),
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
  members: Array<{ event_player_id: string; role: string }>;
}

/**
 * Insert teams and their members. Returns the new teams in input order.
 */
export async function insertTeamsWithMembers(
  ex: Executor,
  eventId: string,
  newTeams: NewTeam[]
): Promise<Array<{ id: string; seed: number | null; pool_combo: string | null }>> {
  // One insert per team: a multi-row RETURNING isn't guaranteed to come back in input order.
  const inserted: Array<{ id: string; seed: number | null; pool_combo: string | null }> = [];
  for (const t of newTeams) {
    const [team] = await ex
      .insert(teams)
      .values({ event_id: eventId, seed: t.seed, pool_combo: t.pool_combo })
      .returning({ id: teams.id, seed: teams.seed, pool_combo: teams.pool_combo });
    if (t.members.length > 0) {
      await ex
        .insert(team_members)
        .values(t.members.map((m) => ({ team_id: team.id, event_player_id: m.event_player_id, role: m.role })));
    }
    inserted.push(team);
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
