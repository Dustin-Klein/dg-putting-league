/** @jest-environment node */

import { PUT as putPublicScore } from '../route';
import { PUT as putPublicBatch } from '../batch/route';
import { PUT as putAdminScore } from '../../../../event/[eventId]/bracket/match/[matchId]/scoring/route';
import { recordScoreAndGetMatch, batchRecordScoresAndGetMatch } from '@/lib/services/scoring/public-scoring';
import { recordScoreAdmin } from '@/lib/services/scoring/match-scoring';

jest.mock('@/lib/services/scoring/score-submission', () => ({ MAX_FRAME_NUMBER: 50 }));
jest.mock('@/lib/services/scoring/public-scoring', () => ({
  getMatchForScoring: jest.fn(),
  recordScoreAndGetMatch: jest.fn(),
  completeMatchPublic: jest.fn(),
  startMatchPublic: jest.fn(),
  batchRecordScoresAndGetMatch: jest.fn(),
}));
jest.mock('@/lib/services/scoring/match-scoring', () => ({
  getBracketMatchWithDetails: jest.fn(),
  recordScoreAdmin: jest.fn(),
  completeBracketMatch: jest.fn(),
  completeMatchWithFinalScores: jest.fn(),
  correctMatchScores: jest.fn(),
  clearScoreOverride: jest.fn(),
}));
jest.mock('@/lib/services/event', () => ({ requireEventAdmin: jest.fn().mockResolvedValue({}) }));
jest.mock('@/lib/middleware/rate-limit', () => ({
  withScoringRateLimit: jest.fn().mockResolvedValue(null),
  recordAccessCodeFailure: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/utils', () => ({ validateCsrfOrigin: jest.fn() }));

const playerId = '00000000-0000-4000-8000-000000000001';

function request(body: unknown): Request {
  return new Request('http://localhost/api/score/match/1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.each([0, 1.5, 51])('frame_number %s', (frameNumber) => {
  beforeEach(() => jest.clearAllMocks());

  it('is rejected by the public single-score route', async () => {
    const response = await putPublicScore(
      request({ access_code: 'abcdef', frame_number: frameNumber, event_player_id: playerId, putts_made: 1 }),
      { params: Promise.resolve({ matchId: '1' }) }
    );

    expect(response.status).toBe(400);
    expect(recordScoreAndGetMatch).not.toHaveBeenCalled();
  });

  it('is rejected by the public batch route', async () => {
    const response = await putPublicBatch(
      request({
        access_code: 'abcdef',
        frame_number: frameNumber,
        scores: [{ event_player_id: playerId, putts_made: 1 }],
      }),
      { params: Promise.resolve({ matchId: '1' }) }
    );

    expect(response.status).toBe(400);
    expect(batchRecordScoresAndGetMatch).not.toHaveBeenCalled();
  });

  it('is rejected by the admin score route', async () => {
    const response = await putAdminScore(
      request({ frame_number: frameNumber, event_player_id: playerId, putts_made: 1 }),
      { params: Promise.resolve({ eventId: 'event-1', matchId: '1' }) }
    );

    expect(response.status).toBe(400);
    expect(recordScoreAdmin).not.toHaveBeenCalled();
  });
});
