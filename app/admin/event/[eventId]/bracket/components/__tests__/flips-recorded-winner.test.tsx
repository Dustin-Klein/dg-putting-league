import { flipsRecordedWinner } from '../match-scoring-dialog';
import type { BracketMatchWithDetails } from '@/lib/types/scoring';

function completed(team1Won: boolean | null): BracketMatchWithDetails {
  const result = (won: boolean | null) => (won === null ? undefined : won ? 'win' : 'loss');
  return {
    opponent1: { id: 1, score: 10, result: result(team1Won) },
    opponent2: { id: 2, score: 8, result: result(team1Won === null ? null : !team1Won) },
  } as unknown as BracketMatchWithDetails;
}

describe('flipsRecordedWinner', () => {
  it('is true when the other team would now win', () => {
    expect(flipsRecordedWinner(completed(true), 8, 10)).toBe(true);
    expect(flipsRecordedWinner(completed(false), 10, 8)).toBe(true);
  });

  it('is false when the recorded winner still wins', () => {
    expect(flipsRecordedWinner(completed(true), 12, 3)).toBe(false);
    expect(flipsRecordedWinner(completed(false), 3, 12)).toBe(false);
  });

  it('ignores ties, invalid scores and matches without a recorded winner', () => {
    expect(flipsRecordedWinner(completed(true), 9, 9)).toBe(false);
    expect(flipsRecordedWinner(completed(true), NaN, 4)).toBe(false);
    expect(flipsRecordedWinner(completed(null), 2, 9)).toBe(false);
  });
});
