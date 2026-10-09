import * as scoreDb from '@/lib/repositories/match-scores-repository.db';
import {
  applyScoresToOpponentJson,
  computeMatchScores,
  syncMatchScores,
} from '../match-scores';
import type { Executor } from '@/lib/db/tx';

jest.mock('@/lib/repositories/match-scores-repository.db', () => ({
  getMatchScoreSource: jest.fn(),
  getParticipantTeamIds: jest.fn(),
  getFrameScoreSums: jest.fn(),
  writeMatchScores: jest.fn(),
}));

const ex = {} as Executor;
const mocked = jest.mocked(scoreDb);

beforeEach(() => jest.clearAllMocks());

describe('computeMatchScores', () => {
  it('prefers the paired manual override without reading frames', async () => {
    mocked.getMatchScoreSource.mockResolvedValue({
      opponent1: { id: 11 },
      opponent2: { id: 12 },
      scoreOverride1: 9,
      scoreOverride2: 7,
    });

    await expect(computeMatchScores(ex, 1)).resolves.toEqual({ team1Score: 9, team2Score: 7 });
    expect(mocked.getFrameScoreSums).not.toHaveBeenCalled();
  });

  it('attributes frame sums through each participant team and returns null with no results', async () => {
    mocked.getMatchScoreSource.mockResolvedValue({
      opponent1: { id: 11 },
      opponent2: { id: 12 },
      scoreOverride1: null,
      scoreOverride2: null,
    });
    mocked.getParticipantTeamIds.mockResolvedValue(new Map([[11, 'team-a'], [12, 'team-b']]));
    mocked.getFrameScoreSums.mockResolvedValueOnce({
      resultCount: 4,
      scores: new Map([['team-a', 8], ['team-b', 5]]),
    });
    await expect(computeMatchScores(ex, 1)).resolves.toEqual({ team1Score: 8, team2Score: 5 });

    mocked.getFrameScoreSums.mockResolvedValueOnce({ resultCount: 0, scores: new Map() });
    await expect(computeMatchScores(ex, 1)).resolves.toBeNull();
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
    mocked.getMatchScoreSource
      .mockResolvedValueOnce({
        opponent1: { id: 1, position: 4, result: 'win' },
        opponent2: { id: 2, position: 5, result: 'loss' },
        scoreOverride1: 12,
        scoreOverride2: 10,
      })
      .mockResolvedValueOnce({
        opponent1: { id: 1, position: 4, result: 'win' },
        opponent2: { id: 2, position: 5, result: 'loss' },
        scoreOverride1: 12,
        scoreOverride2: 10,
      });

    await expect(syncMatchScores(ex, 7)).resolves.toEqual({ team1Score: 12, team2Score: 10 });
    expect(mocked.writeMatchScores).toHaveBeenCalledWith(
      ex,
      7,
      { id: 1, position: 4, result: 'win', score: 12 },
      { id: 2, position: 5, result: 'loss', score: 10 }
    );
  });
});
