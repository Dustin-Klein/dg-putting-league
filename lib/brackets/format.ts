/**
 * Bracket formats and what each brackets-manager group means in them. Pure: importable
 * from services, repositories and client components.
 */

export const BRACKET_FORMATS = ['double_elimination', 'single_elimination'] as const;
export type BracketFormat = (typeof BRACKET_FORMATS)[number];

/** brackets-manager numbers groups per stage type (see its helpers' isWinnerBracket etc.). */
export type GroupRole = 'winners' | 'losers' | 'grand_final' | 'main' | 'third_place';

export function isBracketFormat(value: unknown): value is BracketFormat {
  return typeof value === 'string' && (BRACKET_FORMATS as readonly string[]).includes(value);
}

/** A stage type stored before formats existed is always double elimination. */
export function stageFormat(stageType: string | null | undefined): BracketFormat {
  return stageType === 'single_elimination' ? 'single_elimination' : 'double_elimination';
}

export function groupRole(format: BracketFormat, groupNumber: number): GroupRole | null {
  if (format === 'single_elimination') {
    if (groupNumber === 1) return 'main';
    if (groupNumber === 2) return 'third_place';
    return null;
  }
  if (groupNumber === 1) return 'winners';
  if (groupNumber === 2) return 'losers';
  if (groupNumber === 3) return 'grand_final';
  return null;
}

export const DOUBLE_ELIM_GRAND_FINAL_GROUP = 3;

export function isGrandFinalGroup(format: BracketFormat, groupNumber: number): boolean {
  return groupRole(format, groupNumber) === 'grand_final';
}

export interface BracketFormatSettings {
  bracket_format: BracketFormat;
  double_grand_final: boolean;
  third_place_match: boolean;
}

export const DEFAULT_BRACKET_FORMAT_SETTINGS: BracketFormatSettings = {
  bracket_format: 'double_elimination',
  double_grand_final: true,
  third_place_match: false,
};

/**
 * Settings after applying a patch: switching format clears the flag that no longer
 * applies. Returns an error message for an explicit contradiction instead.
 */
export function resolveBracketFormatSettings(
  current: BracketFormatSettings,
  patch: Partial<BracketFormatSettings>
): BracketFormatSettings | { error: string } {
  const format = patch.bracket_format ?? current.bracket_format;
  const switching = format !== current.bracket_format;
  if (format === 'single_elimination') {
    if (patch.double_grand_final === true) {
      return { error: 'A double grand final is only available for double elimination' };
    }
    return {
      bracket_format: format,
      double_grand_final: false,
      third_place_match: patch.third_place_match ?? (switching ? false : current.third_place_match),
    };
  }
  if (patch.third_place_match === true) {
    return { error: 'A third-place match is only available for single elimination' };
  }
  return {
    bracket_format: format,
    // Double elimination's long-standing default is a double grand final.
    double_grand_final: patch.double_grand_final ?? (switching ? true : current.double_grand_final),
    third_place_match: false,
  };
}
