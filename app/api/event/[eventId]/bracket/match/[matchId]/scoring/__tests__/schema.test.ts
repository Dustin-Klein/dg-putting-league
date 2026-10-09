import { finalScoreSchema, recordScoreSchema } from '../route';

jest.mock('@/lib/services/scoring/match-scoring', () => ({}));
jest.mock('@/lib/services/event', () => ({}));
jest.mock('@/lib/middleware/rate-limit', () => ({}));
jest.mock('@/lib/services/scoring/score-submission', () => ({ MAX_FRAME_NUMBER: 50 }));

describe('match scoring route schemas', () => {
  it('accepts integer, non-negative final scores and rejects fractions', () => {
    expect(finalScoreSchema.safeParse({ team1_score: 12, team2_score: 9 }).success).toBe(true);
    expect(finalScoreSchema.safeParse({ team1_score: 1.5, team2_score: 1 }).success).toBe(false);
  });

  it('bounds frame inputs', () => {
    const base = {
      frame_number: 1,
      event_player_id: '00000000-0000-4000-8000-000000000001',
      putts_made: 3,
    };
    expect(recordScoreSchema.safeParse(base).success).toBe(true);
    expect(recordScoreSchema.safeParse({ ...base, frame_number: 51 }).success).toBe(false);
    expect(recordScoreSchema.safeParse({ ...base, putts_made: 4 }).success).toBe(false);
  });
});
