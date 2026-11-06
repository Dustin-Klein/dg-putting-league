import { seedZonesSchema } from '../schemas';

const PLAYER = '00000000-0000-4000-8000-000000000002';

describe('seedZonesSchema', () => {
  const row = { player_id: PLAYER, zone: 2 };

  it('accepts assignments with an optional, trimmed note', () => {
    expect(seedZonesSchema.parse({ assignments: [row], note: '  Cuts 7.3 / 10.3 ' }))
      .toEqual({ assignments: [row], note: 'Cuts 7.3 / 10.3' });
    expect(seedZonesSchema.safeParse({ assignments: Array(500).fill(row) }).success).toBe(true);
  });

  it.each([
    ['an empty list', { assignments: [] }],
    ['501 rows', { assignments: Array(501).fill(row) }],
    ['a bad uuid', { assignments: [{ player_id: 'nope', zone: 2 }] }],
    ['zone 0', { assignments: [{ player_id: PLAYER, zone: 0 }] }],
    ['a zone past the maximum', { assignments: [{ player_id: PLAYER, zone: 10 }] }],
    ['a long note', { assignments: [row], note: 'x'.repeat(1001) }],
  ])('refuses %s', (_name, body) => {
    expect(seedZonesSchema.safeParse(body).success).toBe(false);
  });
});
