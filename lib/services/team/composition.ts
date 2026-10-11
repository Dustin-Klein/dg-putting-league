import type { TeamAssignment } from '@/lib/types/event';
import type { TeamMemberPairing, TeamPairing } from '@/lib/types/team';

export type { TeamMemberPairing, TeamPairing };

/**
 * The two independent axes of how an event forms bracket entrants (plan 07, Decision 1).
 */
export interface TeamFormat {
  teamSize: number;
  teamAssignment: TeamAssignment;
}

/** What building a team needs to know about a player. */
export interface TeamEntrant {
  eventPlayerId: string;
  playerName: string;
  pfaScore: number;
}

/**
 * Pools are an input to the random doubles draw only; every other format leaves
 * event_players.pool NULL.
 */
export function usesPools(format: TeamFormat): boolean {
  return format.teamSize === 2 && format.teamAssignment === 'random_pairing';
}

/**
 * Null when `playerCount` splits evenly into teams of `teamSize`, otherwise a
 * message naming how many players to add or remove.
 */
export function teamSizeShortfallMessage(playerCount: number, teamSize: number): string | null {
  const over = playerCount % teamSize;
  if (over === 0) return null;
  const under = teamSize - over;
  const players = (n: number) => `${n} player${n === 1 ? '' : 's'}`;
  return `${players(playerCount)} can't be split into teams of ${teamSize}: add ${players(under)} or remove ${players(over)}`;
}

/**
 * A team from its members in slot order. Seed is assigned by `seedTeams`.
 */
export function buildTeamPairing(members: readonly TeamEntrant[]): TeamPairing {
  return {
    seed: 0,
    poolCombo: members.map((member) => member.playerName).join(' & '),
    combinedScore: members.reduce((sum, member) => sum + member.pfaScore, 0),
    members: members.map((member, index) => ({ eventPlayerId: member.eventPlayerId, slot: index + 1 })),
  };
}

/**
 * Seed by combined score, highest first. The sort is stable, so ties keep their
 * input order. Sorts and assigns in place, and returns the array.
 */
export function seedTeams(teams: TeamPairing[]): TeamPairing[] {
  teams.sort((a, b) => b.combinedScore - a.combinedScore);
  teams.forEach((team, index) => {
    team.seed = index + 1;
  });
  return teams;
}
