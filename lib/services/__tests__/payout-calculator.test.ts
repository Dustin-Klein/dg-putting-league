import {
  getDefaultPayoutStructure,
  calculatePayouts,
} from '../event/payout-calculator';

describe('getDefaultPayoutStructure', () => {
  it('returns 100% to 1st for ≤4 teams', () => {
    expect(getDefaultPayoutStructure(1)).toEqual([{ place: 1, percentage: 100 }]);
    expect(getDefaultPayoutStructure(4)).toEqual([{ place: 1, percentage: 100 }]);
  });

  it('returns 70/30 for 5-8 teams', () => {
    const result = getDefaultPayoutStructure(5);
    expect(result).toEqual([
      { place: 1, percentage: 70 },
      { place: 2, percentage: 30 },
    ]);
    expect(getDefaultPayoutStructure(8)).toEqual(result);
  });

  it('returns 50/30/20 for 9-16 teams', () => {
    const result = getDefaultPayoutStructure(9);
    expect(result).toEqual([
      { place: 1, percentage: 50 },
      { place: 2, percentage: 30 },
      { place: 3, percentage: 20 },
    ]);
    expect(getDefaultPayoutStructure(16)).toEqual(result);
  });

  it('returns 40/25/20/15 for 17+ teams', () => {
    const result = getDefaultPayoutStructure(17);
    expect(result).toEqual([
      { place: 1, percentage: 40 },
      { place: 2, percentage: 25 },
      { place: 3, percentage: 20 },
      { place: 4, percentage: 15 },
    ]);
    expect(getDefaultPayoutStructure(32)).toEqual(result);
  });

  it('percentages always sum to 100', () => {
    for (const count of [1, 4, 5, 8, 9, 16, 17, 50]) {
      const structure = getDefaultPayoutStructure(count);
      const sum = structure.reduce((acc, s) => acc + s.percentage, 0);
      expect(sum).toBe(100);
    }
  });
});

describe('calculatePayouts', () => {
  it('returns empty array for zero pot', () => {
    const structure = [{ place: 1, percentage: 100 }];
    expect(calculatePayouts(5, 0, structure)).toEqual([]);
  });

  it('returns empty array for empty structure', () => {
    expect(calculatePayouts(5, 10, [])).toEqual([]);
  });

  it('gives 100% to 1st for single-place structure', () => {
    const result = calculatePayouts(5, 10, [{ place: 1, percentage: 100 }]);
    expect(result).toEqual([{ place: 1, percentage: 100, amount: 50 }]);
  });

  it('rounds non-1st amounts to nearest entry fee multiple', () => {
    // $5 fee, 10 players = $50 pot, 70/30 split
    // 2nd raw: $15.00 → rounds to $15 (nearest $5)
    // 1st: $50 - $15 = $35
    const result = calculatePayouts(5, 10, [
      { place: 1, percentage: 70 },
      { place: 2, percentage: 30 },
    ]);
    expect(result).toEqual([
      { place: 1, percentage: 70, amount: 35 },
      { place: 2, percentage: 30, amount: 15 },
    ]);
  });

  it('1st place absorbs rounding remainder', () => {
    // $5 fee, 7 players = $35 pot, 50/30/20 split
    // 3rd raw: $7.00 → rounds to $5 (nearest $5)
    // 2nd raw: $10.50 → rounds to $10 (nearest $5)
    // 1st: $35 - $5 - $10 = $20
    const result = calculatePayouts(5, 7, [
      { place: 1, percentage: 50 },
      { place: 2, percentage: 30 },
      { place: 3, percentage: 20 },
    ]);
    expect(result[0].amount + result[1].amount + result[2].amount).toBe(35);
    expect(result[0].place).toBe(1);
    expect(result[1].amount).toBe(10);
    expect(result[2].amount).toBe(5);
    expect(result[0].amount).toBe(20);
  });

  it('total always equals pot', () => {
    const entryFee = 5;
    const playerCount = 13;
    const pot = entryFee * playerCount; // $65
    const structure = [
      { place: 1, percentage: 40 },
      { place: 2, percentage: 25 },
      { place: 3, percentage: 20 },
      { place: 4, percentage: 15 },
    ];
    const result = calculatePayouts(entryFee, playerCount, structure);
    const total = result.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(pot);
  });

  it('subtracts admin fees from pot', () => {
    // $5 fee, 10 players = $50 gross, $10 admin fees = $40 net pot
    // 70/30 split: 2nd raw = $12 → rounds to $10, 1st = $40 - $10 = $30
    const result = calculatePayouts(5, 10, [
      { place: 1, percentage: 70 },
      { place: 2, percentage: 30 },
    ], 10);
    expect(result[0].amount + result[1].amount).toBe(40);
    expect(result[1].amount).toBe(10);
    expect(result[0].amount).toBe(30);
  });

  it('rounds correctly with reduced pot from admin fees', () => {
    // $5 fee, 8 players = $40 gross, $5 admin fees = $35 net pot
    // 50/30/20 split
    // 3rd raw: $7.00 → rounds to $5
    // 2nd raw: $10.50 → rounds to $10
    // 1st: $35 - $5 - $10 = $20
    const result = calculatePayouts(5, 8, [
      { place: 1, percentage: 50 },
      { place: 2, percentage: 30 },
      { place: 3, percentage: 20 },
    ], 5);
    const total = result.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(35);
    expect(result[2].amount).toBe(5);
    expect(result[1].amount).toBe(10);
    expect(result[0].amount).toBe(20);
  });

  it('returns empty when admin fees >= total pot', () => {
    const result = calculatePayouts(5, 10, [
      { place: 1, percentage: 100 },
    ], 50);
    expect(result).toEqual([]);

    const result2 = calculatePayouts(5, 10, [
      { place: 1, percentage: 100 },
    ], 60);
    expect(result2).toEqual([]);
  });

  it('defaults admin fees to 0 (existing tests unaffected)', () => {
    // Same as the "gives 100% to 1st for single-place structure" test
    const result = calculatePayouts(5, 10, [{ place: 1, percentage: 100 }]);
    expect(result).toEqual([{ place: 1, percentage: 100, amount: 50 }]);
  });

  it('subtracts per-player fee correctly', () => {
    // $5 fee, 10 players = $50 gross, $2/player = $20 per-player fees, $30 net pot
    const result = calculatePayouts(5, 10, [{ place: 1, percentage: 100 }], 0, 2);
    expect(result).toEqual([{ place: 1, percentage: 100, amount: 30 }]);
  });

  it('subtracts both flat and per-player fees combined', () => {
    // $5 fee, 10 players = $50 gross, $10 flat + $1/player = $30 net pot
    const result = calculatePayouts(5, 10, [
      { place: 1, percentage: 70 },
      { place: 2, percentage: 30 },
    ], 10, 1);
    expect(result[0].amount + result[1].amount).toBe(30);
  });

  it('returns empty when combined fees >= pot', () => {
    // $5 fee, 10 players = $50 gross, $30 flat + $2/player = $50 total fees
    const result = calculatePayouts(5, 10, [{ place: 1, percentage: 100 }], 30, 2);
    expect(result).toEqual([]);

    // fees exceed pot
    const result2 = calculatePayouts(5, 10, [{ place: 1, percentage: 100 }], 30, 3);
    expect(result2).toEqual([]);
  });

  it('handles large entry fee with small pot', () => {
    // $10 fee, 3 players = $30 pot, 70/30 split
    // 2nd raw: $9 → rounds to $10
    // 1st: $30 - $10 = $20
    const result = calculatePayouts(10, 3, [
      { place: 1, percentage: 70 },
      { place: 2, percentage: 30 },
    ]);
    expect(result[0].amount + result[1].amount).toBe(30);
    expect(result[1].amount).toBe(10);
    expect(result[0].amount).toBe(20);
  });
});
