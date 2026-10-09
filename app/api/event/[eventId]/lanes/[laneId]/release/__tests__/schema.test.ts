import { releaseLaneSchema } from '../route';

jest.mock('@/lib/services/lane', () => ({}));
jest.mock('@/lib/services/event', () => ({}));

describe('release lane route schema', () => {
  it('accepts an integer match ID and optional force flag', () => {
    expect(releaseLaneSchema.parse({ matchId: 42 })).toEqual({ matchId: 42 });
    expect(releaseLaneSchema.parse({ matchId: 42, force: true })).toEqual({ matchId: 42, force: true });
  });

  it('rejects non-integer match IDs and non-boolean force flags', () => {
    expect(releaseLaneSchema.safeParse({ matchId: 1.5 }).success).toBe(false);
    expect(releaseLaneSchema.safeParse({ matchId: 42, force: 'true' }).success).toBe(false);
  });
});
