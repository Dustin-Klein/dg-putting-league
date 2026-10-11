/** A player on a placed team of the parent event (one row per team member). */
export interface PlacedPlayer {
  teamId: string;
  placement: number;
  playerId: string;
}

/** Default second-chance cut: only the winning team is excluded. */
export const DEFAULT_SECOND_CHANCE_EXCLUDED_PLACEMENTS = 1;

/**
 * Players eligible for a second-chance event: every player on a team placed below
 * `excludeTopPlacements` (placements are per team; a tie at the cut is excluded
 * together). The default excludes only the winners, i.e. everyone who lost at least
 * once gets in. Returns player ids, de-duplicated, in input order.
 */
export function selectSecondChancePlayers(
  placedPlayers: readonly PlacedPlayer[],
  excludeTopPlacements: number = DEFAULT_SECOND_CHANCE_EXCLUDED_PLACEMENTS
): string[] {
  const eligible = new Set<string>();
  for (const { placement, playerId } of placedPlayers) {
    if (placement > excludeTopPlacements) {
      eligible.add(playerId);
    }
  }
  return [...eligible];
}
