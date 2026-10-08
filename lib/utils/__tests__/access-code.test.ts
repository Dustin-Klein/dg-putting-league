import { normalizeAccessCode } from '../access-code';

describe('normalizeAccessCode', () => {
  it('trims and lower-cases', () => {
    expect(normalizeAccessCode('  AbC123 ')).toBe('abc123');
  });

  it('leaves LIKE wildcards as literal characters', () => {
    expect(normalizeAccessCode('%')).toBe('%');
    expect(normalizeAccessCode('a_b%')).toBe('a_b%');
  });
});
