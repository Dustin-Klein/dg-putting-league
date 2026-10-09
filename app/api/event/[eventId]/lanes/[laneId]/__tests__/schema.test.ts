import { updateLaneSchema } from '../route';

jest.mock('@/lib/services/lane', () => ({}));
jest.mock('@/lib/services/event', () => ({}));

describe('lane maintenance route schema', () => {
  it('defaults confirm to false and accepts an explicit confirmation', () => {
    expect(updateLaneSchema.parse({ status: 'maintenance' })).toEqual({
      status: 'maintenance',
      confirm: false,
    });
    expect(updateLaneSchema.parse({ status: 'maintenance', confirm: true }).confirm).toBe(true);
  });

  it('rejects non-boolean confirmation values', () => {
    expect(updateLaneSchema.safeParse({ status: 'maintenance', confirm: 'true' }).success).toBe(false);
  });
});
