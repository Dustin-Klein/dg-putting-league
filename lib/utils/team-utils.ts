import type { TeamAssignment } from '@/lib/types/event';
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

export const TEAM_SIZE_LABELS: Record<number, string> = {
  1: 'Singles',
  2: 'Doubles',
  3: 'Triples',
  4: 'Teams of 4',
};

/**
 * The assignment methods that make sense for a team size, with labels. The pool
 * draw exists only for doubles. Singles has one option: every player is their own
 * entrant, seeded by score.
 */
export function teamAssignmentOptions(teamSize: number): Array<{ value: TeamAssignment; label: string }> {
  if (teamSize === 1) {
    return [{ value: 'random_pairing', label: 'Every player enters alone' }];
  }
  return [
    ...(teamSize === 2 ? [{ value: 'random_pairing' as const, label: 'Random draw, one from Pool A and Pool B' }] : []),
    { value: 'random_flat', label: 'Random draw, no pools' },
    { value: 'manual', label: 'Organizer picks teams' },
  ];
}

/** "Doubles, Pool A/B draw", "Triples, manual teams", ... */
export function describeTeamFormat(teamSize: number, teamAssignment: TeamAssignment): string {
  const size = TEAM_SIZE_LABELS[teamSize] ?? `Teams of ${teamSize}`;
  if (teamSize === 1) return size;
  const method = {
    random_pairing: 'Pool A/B draw',
    random_flat: 'random draw',
    manual: 'manual teams',
  }[teamAssignment];
  return `${size}, ${method}`;
}
