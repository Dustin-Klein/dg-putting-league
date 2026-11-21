import { BadRequestError, ConflictError } from '@/lib/errors';
import { STALE_PREVIEW_MESSAGE } from '@/lib/constants/event';
import type { PlayerScore, PoolAssignment } from '@/lib/services/event-player';
import {
  buildTeamPairing,
  seedTeams,
  teamSizeShortfallMessage,
  type TeamMemberPairing,
  type TeamPairing,
} from '@/lib/services/team/composition';

export type ProvidedPoolAssignment =
  Pick<PoolAssignment, 'eventPlayerId' | 'pool'> &
  Partial<Omit<PoolAssignment, 'eventPlayerId' | 'pool'>>;

export type ProvidedTeamPairing =
  { members: TeamMemberPairing[] } &
  Partial<Omit<TeamPairing, 'members'>>;

/**
 * The server-computed scores must cover exactly the players registered now.
 */
export function assertRosterCurrent(currentEventPlayerIds: string[], players: PlayerScore[]): void {
  const scored = new Set(players.map((player) => player.eventPlayerId));
  if (scored.size !== currentEventPlayerIds.length || currentEventPlayerIds.some((id) => !scored.has(id))) {
    throw new ConflictError(STALE_PREVIEW_MESSAGE);
  }
}

/**
 * Merge the client's pool choice onto the server-computed player scores. The
 * client controls only pool choice. Identity and score metadata are authoritative.
 */
export function resolvePoolAssignments(input: {
  players: PlayerScore[];
  providedPoolAssignments: ProvidedPoolAssignment[];
}): PoolAssignment[] {
  const { players, providedPoolAssignments } = input;
  const providedIds = providedPoolAssignments.map((assignment) => assignment.eventPlayerId);
  if (new Set(providedIds).size !== providedIds.length) {
    throw new BadRequestError('Pool assignments must contain each player exactly once');
  }

  const playerById = new Map(players.map((player) => [player.eventPlayerId, player]));
  if (providedIds.length !== playerById.size || providedIds.some((id) => !playerById.has(id))) {
    throw new ConflictError(STALE_PREVIEW_MESSAGE);
  }

  return providedPoolAssignments.map((provided) => ({
    ...playerById.get(provided.eventPlayerId)!,
    pool: provided.pool,
  }));
}

/**
 * Every player on exactly one team of exactly `teamSize`, with slots 1..teamSize.
 * Applies to every team format. Names and scores are rebuilt from `players`; the
 * submitted seed, poolCombo and combinedScore are discarded.
 *
 * A team that names a player who is no longer registered, or leaves out one who
 * now is, means the roster changed since the preview: that is a conflict.
 */
export function validateTeamComposition(input: {
  players: PlayerScore[];
  teams: ProvidedTeamPairing[];
  teamSize: number;
}): TeamPairing[] {
  const { players, teams, teamSize } = input;
  const shortfall = teamSizeShortfallMessage(players.length, teamSize);
  if (shortfall) {
    throw new BadRequestError(shortfall);
  }

  const playerById = new Map(players.map((player) => [player.eventPlayerId, player]));
  const seenMembers = new Set<string>();
  const normalized = teams.map((team) => {
    if (team.members.length !== teamSize) {
      throw new BadRequestError(
        `Each team must have exactly ${teamSize} member${teamSize === 1 ? '' : 's'}`
      );
    }
    const memberIds = team.members.map((member) => member.eventPlayerId);
    if (new Set(memberIds).size !== memberIds.length) {
      throw new BadRequestError('A player cannot appear more than once in a team');
    }
    const slots = team.members.map((member) => member.slot);
    if (
      new Set(slots).size !== slots.length ||
      slots.some((slot) => !Number.isInteger(slot) || slot < 1 || slot > teamSize)
    ) {
      throw new BadRequestError(`Team slots must be 1 to ${teamSize}, each used once`);
    }
    for (const id of memberIds) {
      if (seenMembers.has(id)) {
        throw new BadRequestError('A player cannot be assigned to more than one team');
      }
      seenMembers.add(id);
    }

    const ordered = [...team.members].sort((a, b) => a.slot - b.slot);
    return ordered.map((member) => playerById.get(member.eventPlayerId));
  });

  if (seenMembers.size !== playerById.size || [...seenMembers].some((id) => !playerById.has(id))) {
    throw new ConflictError(STALE_PREVIEW_MESSAGE);
  }

  // Stable sort mirrors computeTeamPairings: ties retain the submitted team order.
  return seedTeams(normalized.map((members) => buildTeamPairing(members as PlayerScore[])));
}

/**
 * Pool-paired doubles only: each team holds one Pool A and one Pool B player.
 * Run after `validateTeamComposition`.
 */
export function validatePoolPairing(input: {
  teams: TeamPairing[];
  assignments: PoolAssignment[];
}): void {
  const poolById = new Map(input.assignments.map((assignment) => [assignment.eventPlayerId, assignment.pool]));
  for (const team of input.teams) {
    const pools = team.members.map((member) => poolById.get(member.eventPlayerId));
    if (pools.length !== 2 || !pools.includes('A') || !pools.includes('B')) {
      throw new BadRequestError('Each team must contain one Pool A player and one Pool B player');
    }
  }
}

export interface KeptTeam {
  members: Array<{ event_player_id: string; slot: number; pool: 'A' | 'B' | null }>;
}

export interface KeptTeamPreview {
  players: Array<PlayerScore & { pool: 'A' | 'B' | null }>;
  teamPairings: TeamPairing[];
  keptTeamCount: number;
  /** Seeds of the teams formed from newcomers. */
  newTeamSeeds: number[];
}

/**
 * The draw after registration was reopened with "keep teams": every kept team whose
 * members are all still registered stays as it was; everyone else (newcomers, and the
 * partner of anyone who left) is paired among themselves, highest score first. For
 * pool-paired doubles kept members keep their pool and newcomers split top half A,
 * bottom half B, so they always pair. Seeds are recomputed over every team.
 */
export function keptTeamPreview(input: {
  scores: PlayerScore[];
  kept: KeptTeam[];
  teamSize: number;
  pooled: boolean;
}): KeptTeamPreview {
  const { scores, kept, teamSize, pooled } = input;
  const byId = new Map(scores.map((score) => [score.eventPlayerId, score]));
  const keptTeams = kept.filter(
    (team) => team.members.length === teamSize && team.members.every((m) => byId.has(m.event_player_id))
  );
  const keptPool = new Map(keptTeams.flatMap((team) => team.members.map((m) => [m.event_player_id, m.pool] as const)));
  const newcomers = scores
    .filter((score) => !keptPool.has(score.eventPlayerId))
    .sort((a, b) => b.pfaScore - a.pfaScore);

  const newcomerPool = new Map<string, 'A' | 'B' | null>();
  const newTeams: TeamPairing[] = [];
  if (pooled) {
    const half = Math.ceil(newcomers.length / 2);
    const poolA = newcomers.slice(0, half);
    const poolB = newcomers.slice(half);
    poolA.forEach((p) => newcomerPool.set(p.eventPlayerId, 'A'));
    poolB.forEach((p) => newcomerPool.set(p.eventPlayerId, 'B'));
    for (let i = 0; i < Math.min(poolA.length, poolB.length); i++) {
      newTeams.push(buildTeamPairing([poolA[i], poolB[i]]));
    }
  } else {
    newcomers.forEach((p) => newcomerPool.set(p.eventPlayerId, null));
    for (let i = 0; i + teamSize <= newcomers.length; i += teamSize) {
      newTeams.push(buildTeamPairing(newcomers.slice(i, i + teamSize)));
    }
  }

  const keptPairings = keptTeams.map((team) =>
    buildTeamPairing([...team.members].sort((a, b) => a.slot - b.slot).map((m) => byId.get(m.event_player_id)!))
  );
  const teamPairings = seedTeams([...keptPairings, ...newTeams]);
  return {
    players: scores.map((score) => ({
      ...score,
      pool: pooled ? (keptPool.get(score.eventPlayerId) ?? newcomerPool.get(score.eventPlayerId) ?? null) : null,
    })),
    teamPairings,
    keptTeamCount: keptPairings.length,
    newTeamSeeds: newTeams.map((team) => team.seed),
  };
}
