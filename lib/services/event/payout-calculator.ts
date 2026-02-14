import type { PayoutPlace } from '@/lib/types/event';

export interface PayoutBreakdown {
  place: number;
  percentage: number;
  amount: number;
}

/**
 * Returns the default payout structure based on team count.
 */
export function getDefaultPayoutStructure(teamCount: number): PayoutPlace[] {
  if (teamCount <= 4) {
    return [{ place: 1, percentage: 100 }];
  }
  if (teamCount <= 8) {
    return [
      { place: 1, percentage: 70 },
      { place: 2, percentage: 30 },
    ];
  }
  if (teamCount <= 16) {
    return [
      { place: 1, percentage: 50 },
      { place: 2, percentage: 30 },
      { place: 3, percentage: 20 },
    ];
  }
  return [
    { place: 1, percentage: 40 },
    { place: 2, percentage: 25 },
    { place: 3, percentage: 20 },
    { place: 4, percentage: 15 },
  ];
}

/**
 * Calculates payout amounts from a structure.
 * Rounds each non-1st-place amount to nearest multiple of entryFee.
 * 1st place absorbs the remainder so the total always equals the pot.
 */
export function calculatePayouts(
  entryFee: number,
  playerCount: number,
  structure: PayoutPlace[],
  adminFees: number = 0,
  adminFeePerPlayer: number = 0
): PayoutBreakdown[] {
  const totalPot = entryFee * playerCount - adminFees - (adminFeePerPlayer * playerCount);

  if (structure.length === 0 || totalPot <= 0) {
    return [];
  }

  if (structure.length === 1) {
    return [{ place: structure[0].place, percentage: structure[0].percentage, amount: totalPot }];
  }

  const sorted = [...structure].sort((a, b) => a.place - b.place);

  // Calculate and round non-1st-place amounts
  let otherTotal = 0;
  const results: PayoutBreakdown[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const rawAmount = (sorted[i].percentage / 100) * totalPot;
    const rounded = entryFee > 0
      ? Math.round(rawAmount / entryFee) * entryFee
      : Math.round(rawAmount * 100) / 100;
    otherTotal += rounded;
    results.push({
      place: sorted[i].place,
      percentage: sorted[i].percentage,
      amount: rounded,
    });
  }

  // 1st place gets the remainder
  const firstPlaceAmount = totalPot - otherTotal;
  results.unshift({
    place: sorted[0].place,
    percentage: sorted[0].percentage,
    amount: firstPlaceAmount,
  });

  return results;
}
