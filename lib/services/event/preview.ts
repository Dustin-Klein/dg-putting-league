import { BadRequestError, ConflictError } from '@/lib/errors';
import { STALE_PREVIEW_MESSAGE } from '@/lib/constants/event';
import type { PoolAssignment } from '@/lib/services/event-player';
import type { TeamPairing } from '@/lib/services/team';

export interface ValidatedPreviewPayload {
  poolAssignments: PoolAssignment[];
  teamPairings: TeamPairing[];
}

export type ProvidedPoolAssignment =
  Pick<PoolAssignment, 'eventPlayerId' | 'pool'> &
  Partial<Omit<PoolAssignment, 'eventPlayerId' | 'pool'>>;

export type ProvidedTeamPairing =
  Pick<TeamPairing, 'members'> &
  Partial<Omit<TeamPairing, 'members'>>;

export function validatePreviewPayload(input: {
  currentEventPlayerIds: string[];
  recomputedPoolAssignments: PoolAssignment[];
  providedPoolAssignments: ProvidedPoolAssignment[];
  providedTeamPairings: ProvidedTeamPairing[];
}): ValidatedPreviewPayload {
  const {
    currentEventPlayerIds,
    recomputedPoolAssignments,
    providedPoolAssignments,
    providedTeamPairings,
  } = input;
  const providedIds = providedPoolAssignments.map((assignment) => assignment.eventPlayerId);
  if (new Set(providedIds).size !== providedIds.length) {
    throw new BadRequestError('Pool assignments must contain each player exactly once');
  }

  const currentIds = new Set(currentEventPlayerIds);
  const providedSet = new Set(providedIds);
  if (
    currentIds.size !== providedSet.size ||
    [...currentIds].some((id) => !providedSet.has(id))
  ) {
    throw new ConflictError(STALE_PREVIEW_MESSAGE);
  }

  const recomputedById = new Map(
    recomputedPoolAssignments.map((assignment) => [assignment.eventPlayerId, assignment])
  );
  if ([...currentIds].some((id) => !recomputedById.has(id))) {
    throw new ConflictError(STALE_PREVIEW_MESSAGE);
  }

  // The client controls only pool choice. Identity and score metadata are authoritative.
  const poolAssignments = providedPoolAssignments.map((provided) => {
    const recomputed = recomputedById.get(provided.eventPlayerId);
    if (!recomputed) throw new ConflictError(STALE_PREVIEW_MESSAGE);
    return { ...recomputed, pool: provided.pool };
  });
  const assignmentById = new Map(poolAssignments.map((assignment) => [assignment.eventPlayerId, assignment]));

  if (currentEventPlayerIds.length % 2 !== 0 || providedTeamPairings.length !== currentEventPlayerIds.length / 2) {
    throw new BadRequestError('Every player must be assigned to a two-player team');
  }

  const seenMembers = new Set<string>();
  const normalizedTeams = providedTeamPairings.map((team) => {
    if (team.members.length !== 2) {
      throw new BadRequestError('Each team must have exactly two members');
    }
    const memberIds = team.members.map((member) => member.eventPlayerId);
    if (new Set(memberIds).size !== 2) {
      throw new BadRequestError('A player cannot appear more than once in a team');
    }
    for (const id of memberIds) {
      if (!currentIds.has(id)) {
        throw new BadRequestError('Teams must contain only players registered for this event');
      }
      if (seenMembers.has(id)) {
        throw new BadRequestError('A player cannot be assigned to more than one team');
      }
      seenMembers.add(id);
    }

    const poolA = team.members.find((member) => member.role === 'A_pool');
    const poolB = team.members.find((member) => member.role === 'B_pool');
    if (
      !poolA ||
      !poolB ||
      assignmentById.get(poolA.eventPlayerId)?.pool !== 'A' ||
      assignmentById.get(poolB.eventPlayerId)?.pool !== 'B'
    ) {
      throw new BadRequestError('Each team must contain one Pool A player and one Pool B player');
    }

    const playerA = assignmentById.get(poolA.eventPlayerId);
    const playerB = assignmentById.get(poolB.eventPlayerId);
    if (!playerA || !playerB) {
      throw new BadRequestError('Teams must contain only players registered for this event');
    }
    return {
      seed: 0,
      poolCombo: `${playerA.playerName} & ${playerB.playerName}`,
      combinedScore: playerA.pfaScore + playerB.pfaScore,
      members: [
        { eventPlayerId: playerA.eventPlayerId, role: 'A_pool' as const },
        { eventPlayerId: playerB.eventPlayerId, role: 'B_pool' as const },
      ],
    };
  });

  if (seenMembers.size !== currentIds.size) {
    throw new BadRequestError('Every player must be assigned to exactly one team');
  }

  // Stable sort mirrors computeTeamPairings: ties retain the submitted pairing order.
  normalizedTeams.sort((a, b) => b.combinedScore - a.combinedScore);
  normalizedTeams.forEach((team, index) => {
    team.seed = index + 1;
  });
  return { poolAssignments, teamPairings: normalizedTeams };
}
