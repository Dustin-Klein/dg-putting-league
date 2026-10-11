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

/**
 * `teamAssignment: 'manual'` marks a hand-edited random draw; the server records it
 * on the event only if the bracket starts.
 */
export type StartBracketRequest = ReturnType<typeof toStartBracketRequest> & { teamAssignment?: 'manual' };

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

/** A manual team draft: one array per team, one event player id (or null) per slot. */
export type TeamDraft = Array<Array<string | null>>;

/** An empty draft with one row per team. */
export function emptyTeamDraft(playerCount: number, teamSize: number): TeamDraft {
  return Array.from({ length: Math.floor(playerCount / teamSize) }, () => Array<string | null>(teamSize).fill(null));
}

/**
 * Why a draft can't be submitted yet, or null when every player is on exactly one
 * full team. For feedback only; the server validates the submission itself.
 */
export function teamDraftProblem(draft: TeamDraft, playerIds: string[], teamSize: number): string | null {
  const over = playerIds.length % teamSize;
  if (over !== 0) {
    return `${playerIds.length} players can't be split into teams of ${teamSize}`;
  }
  const placed = draft.flat().filter((id): id is string => id !== null);
  if (new Set(placed).size !== placed.length) {
    return 'A player is on more than one team';
  }
  const unassigned = playerIds.filter((id) => !placed.includes(id)).length;
  if (unassigned > 0) {
    return `${unassigned} player${unassigned === 1 ? '' : 's'} not on a team yet`;
  }
  if (placed.some((id) => !playerIds.includes(id))) {
    return 'The roster changed; clear the teams and start again';
  }
  return null;
}

/** Team pairings to submit for a complete draft, slots numbered by position. */
export function teamDraftToPairings(draft: TeamDraft): TeamPairing[] {
  return draft.map((team) => ({
    seed: 0,
    poolCombo: '',
    combinedScore: 0,
    members: team.map((eventPlayerId, index) => ({ eventPlayerId: eventPlayerId!, slot: index + 1 })),
  }));
}

/** A draft from a server draw, so an organizer can start from it and edit. */
export function teamDraftFromPairings(pairings: TeamPairing[]): TeamDraft {
  return pairings.map((team) => sortBySlot(team.members).map((member) => member.eventPlayerId));
}
