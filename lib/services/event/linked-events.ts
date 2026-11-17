/** A player on a placed team of the parent event (one row per team member). */
export interface PlacedPlayer {
  teamId: string;
  placement: number;
  playerId: string;
}

/**
 * Players eligible for a completed event's second chance: everyone knocked out, i.e.
 * every player not on the winning team. Returns player ids, de-duplicated, in input order.
 */
export function selectSecondChancePlayers(placedPlayers: readonly PlacedPlayer[]): string[] {
  const eligible = new Set<string>();
  for (const { placement, playerId } of placedPlayers) {
    if (placement > 1) {
      eligible.add(playerId);
    }
  }
  return [...eligible];
}
