/** Minimum length for newly created event access codes. */
export const ACCESS_CODE_MIN_LENGTH = 6;

/**
 * Normalize an event access code for storage and lookup.
 * Codes are case-insensitive, so they are stored and compared as lower(trim(code)).
 * The database enforces the same form with a CHECK constraint.
 */
export function normalizeAccessCode(code: string): string {
  return code.trim().toLowerCase();
}
