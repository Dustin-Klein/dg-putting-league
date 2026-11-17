import { groupRole, resolveBracketFormatSettings, stageFormat, type BracketFormatSettings } from '../format';

const de: BracketFormatSettings = { bracket_format: 'double_elimination', double_grand_final: true, third_place_match: false };
const se: BracketFormatSettings = { bracket_format: 'single_elimination', double_grand_final: false, third_place_match: true };

describe('groupRole', () => {
  it('names double-elimination groups', () => {
    expect([1, 2, 3, 4].map((n) => groupRole('double_elimination', n))).toEqual(['winners', 'losers', 'grand_final', null]);
  });

  it('names single-elimination groups; group 2 is never a grand final', () => {
    expect([1, 2, 3].map((n) => groupRole('single_elimination', n))).toEqual(['main', 'third_place', null]);
  });
});

describe('stageFormat', () => {
  it('treats anything but single elimination as double elimination', () => {
    expect(stageFormat('single_elimination')).toBe('single_elimination');
    expect(stageFormat('double_elimination')).toBe('double_elimination');
    expect(stageFormat(undefined)).toBe('double_elimination');
  });
});

describe('resolveBracketFormatSettings', () => {
  it('keeps current settings for an empty patch', () => {
    expect(resolveBracketFormatSettings(de, {})).toEqual(de);
    expect(resolveBracketFormatSettings(se, {})).toEqual(se);
  });

  it('clears the inapplicable flag when switching format', () => {
    expect(resolveBracketFormatSettings(de, { bracket_format: 'single_elimination' })).toEqual({
      bracket_format: 'single_elimination', double_grand_final: false, third_place_match: false,
    });
    expect(resolveBracketFormatSettings(se, { bracket_format: 'double_elimination' })).toEqual({
      bracket_format: 'double_elimination', double_grand_final: true, third_place_match: false,
    });
  });

  it('applies the format-specific flag in the same patch', () => {
    expect(resolveBracketFormatSettings(de, { bracket_format: 'single_elimination', third_place_match: true }))
      .toEqual(se);
    expect(resolveBracketFormatSettings(se, { bracket_format: 'double_elimination', double_grand_final: false }))
      .toEqual({ ...de, double_grand_final: false });
  });

  it('keeps the third-place choice when the same format is sent again', () => {
    expect(resolveBracketFormatSettings(se, { bracket_format: 'single_elimination' })).toEqual(se);
  });

  it('accepts an explicit false for the flag that does not apply', () => {
    expect(resolveBracketFormatSettings(se, { double_grand_final: false })).toEqual(se);
    expect(resolveBracketFormatSettings(de, { third_place_match: false })).toEqual(de);
  });

  it('rejects contradictions', () => {
    expect(resolveBracketFormatSettings(se, { double_grand_final: true })).toHaveProperty('error');
    expect(resolveBracketFormatSettings(de, { third_place_match: true })).toHaveProperty('error');
    expect(resolveBracketFormatSettings(de, { bracket_format: 'single_elimination', double_grand_final: true }))
      .toHaveProperty('error');
  });
});
