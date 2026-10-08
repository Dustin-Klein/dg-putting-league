import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { bracket_participant, team_members, teams } from '@/lib/db/schema';

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
  if (newTeams.length === 0) return [];

  const inserted = await ex
    .insert(teams)
    .values(newTeams.map((t) => ({ event_id: eventId, seed: t.seed, pool_combo: t.pool_combo })))
    .returning({ id: teams.id, seed: teams.seed, pool_combo: teams.pool_combo });

  const members = inserted.flatMap((team, i) =>
    newTeams[i].members.map((m) => ({ team_id: team.id, event_player_id: m.event_player_id, role: m.role }))
  );
  if (members.length > 0) {
    await ex.insert(team_members).values(members);
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
