import * as scoreDb from '@/lib/repositories/match-scores-repository.db';
import {
  applyScoresToOpponentJson,
  computeMatchScores,
  syncMatchScores,
} from '../match-scores';
import type { Executor } from '@/lib/db/tx';

jest.mock('@/lib/repositories/match-scores-repository.db', () => ({
  getMatchScoreInputs: jest.fn(),
  writeMatchScores: jest.fn(),
}));

const ex = {} as Executor;
const mocked = jest.mocked(scoreDb);

const inputs = (overrides: Partial<scoreDb.MatchScoreInputs>): scoreDb.MatchScoreInputs => ({
  opponent1: { id: 11 },
  opponent2: { id: 12 },
  scoreOverride1: null,
  scoreOverride2: null,
  team1Id: 'team-a',
  team2Id: 'team-b',
  resultCount: 0,
  team1Points: null,
  team2Points: null,
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

describe('computeMatchScores', () => {
  it('prefers the paired manual override', async () => {
    mocked.getMatchScoreInputs.mockResolvedValue(
      inputs({ scoreOverride1: 9, scoreOverride2: 7, resultCount: null })
    );

    await expect(computeMatchScores(ex, 1)).resolves.toEqual({ team1Score: 9, team2Score: 7 });
  });

  it('uses frame sums by team and returns null with no results', async () => {
    mocked.getMatchScoreInputs.mockResolvedValueOnce(inputs({ resultCount: 4, team1Points: 8, team2Points: 5 }));
    await expect(computeMatchScores(ex, 1)).resolves.toEqual({ team1Score: 8, team2Score: 5 });

    mocked.getMatchScoreInputs.mockResolvedValueOnce(inputs({ resultCount: 0 }));
    await expect(computeMatchScores(ex, 1)).resolves.toBeNull();
  });

  it('scores 0-0 when results exist but an opponent has no team, and 0 for a team without points', async () => {
    mocked.getMatchScoreInputs.mockResolvedValueOnce(inputs({ resultCount: 2, team2Id: null, team1Points: 6 }));
    await expect(computeMatchScores(ex, 1)).resolves.toEqual({ team1Score: 0, team2Score: 0 });

    mocked.getMatchScoreInputs.mockResolvedValueOnce(inputs({ resultCount: 2, team1Points: 6, team2Points: null }));
    await expect(computeMatchScores(ex, 1)).resolves.toEqual({ team1Score: 6, team2Score: 0 });
  });

  it('throws for a missing match', async () => {
    mocked.getMatchScoreInputs.mockResolvedValue(null);
    await expect(computeMatchScores(ex, 1)).rejects.toThrow('Match not found');
  });
});

describe('score JSON handling', () => {
  it('preserves opponent keys, preserves SQL NULL, and removes only score for no-score matches', () => {
    expect(
      applyScoresToOpponentJson(
        { id: 1, position: 2, result: 'win', score: 99 },
        null,
        null
      )
    ).toEqual({ opponent1: { id: 1, position: 2, result: 'win' }, opponent2: null });
  });

  it('syncs computed scores without replacing other opponent properties', async () => {
    mocked.getMatchScoreInputs.mockResolvedValueOnce(
      inputs({
        opponent1: { id: 1, position: 4, result: 'win' },
        opponent2: { id: 2, position: 5, result: 'loss' },
        scoreOverride1: 12,
        scoreOverride2: 10,
        resultCount: null,
      })
    );

    await expect(syncMatchScores(ex, 7)).resolves.toEqual({ team1Score: 12, team2Score: 10 });
    expect(mocked.getMatchScoreInputs).toHaveBeenCalledTimes(1);
    expect(mocked.writeMatchScores).toHaveBeenCalledWith(
      ex,
      7,
      { id: 1, position: 4, result: 'win', score: 12 },
      { id: 2, position: 5, result: 'loss', score: 10 }
    );
  });
});
