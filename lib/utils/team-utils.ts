import type { TeamPairing, TeamPreview } from '@/lib/types/team';

/**
 * Team members in position order. Every team-member list renders through this,
 * so a team of any size shows its members the same way.
 */
export function sortBySlot<T extends { slot: number }>(members: readonly T[]): T[] {
  return [...members].sort((a, b) => a.slot - b.slot);
}

/** "Pool A" / "Pool B", or null when the event did not draw from pools. */
export function poolLabel(pool: 'A' | 'B' | null | undefined): string | null {
  return pool ? `Pool ${pool}` : null;
}

/**
 * Body for POST /api/event/[eventId]/start-bracket. Pool choice is sent only
 * for the random doubles draw; every other format leaves pools unset.
 */
export function toStartBracketRequest(preview: TeamPreview, teamPairings: TeamPairing[] = preview.teamPairings) {
  const pooled = preview.teamSize === 2 && preview.teamAssignment === 'random_pairing';
  return {
    ...(pooled
      ? { poolAssignments: preview.players.map((p) => ({ eventPlayerId: p.eventPlayerId, pool: p.pool })) }
      : {}),
    teamPairings: teamPairings.map((team) => ({
      members: team.members.map((m) => ({ eventPlayerId: m.eventPlayerId, slot: m.slot })),
    })),
  };
}

export type StartBracketRequest = ReturnType<typeof toStartBracketRequest>;
