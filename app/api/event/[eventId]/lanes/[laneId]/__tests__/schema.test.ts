import { updateLaneSchema } from '../route';

jest.mock('@/lib/services/lane', () => ({}));
jest.mock('@/lib/services/event', () => ({}));

describe('lane maintenance route schema', () => {
  it('defaults mode to undefined and accepts both maintenance modes', () => {
    expect(updateLaneSchema.parse({ status: 'maintenance' })).toEqual({
      status: 'maintenance',
    });
    expect(updateLaneSchema.parse({ status: 'maintenance', mode: 'after_match' }).mode).toBe('after_match');
    expect(updateLaneSchema.parse({ status: 'maintenance', mode: 'now' }).mode).toBe('now');
  });

  it('rejects unknown maintenance modes', () => {
    expect(updateLaneSchema.safeParse({ status: 'maintenance', mode: 'later' }).success).toBe(false);
  });
});
