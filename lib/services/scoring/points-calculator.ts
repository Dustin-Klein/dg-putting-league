/**
 * Calculate points earned based on putts made and bonus point setting
 *
 * Standard scoring: 1 point per putt made (0-3)
 * Bonus scoring: 4 points if all 3 putts made and bonus is enabled
 */
export function calculatePoints(puttsMade: number, bonusPointEnabled: boolean): number {
  if (puttsMade === 3 && bonusPointEnabled) {
    return 4;
  }
  return puttsMade;
}
