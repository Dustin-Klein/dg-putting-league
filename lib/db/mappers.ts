/**
 * Convert Drizzle values to the JSON shapes PostgREST used to return, so services
 * and the UI keep the same contracts after a repository moves to Drizzle.
 */

/** `numeric` columns arrive as strings; PostgREST returned numbers. */
export function toNumber(value: string | number): number;
export function toNumber(value: string | number | null): number | null;
export function toNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * `timestamptz` columns (mode 'string') arrive as `2026-10-08 12:00:00.123+00`, which
 * not every browser parses; PostgREST returned ISO 8601.
 */
export function toIsoTimestamp(value: string): string;
export function toIsoTimestamp(value: string | null): string | null;
export function toIsoTimestamp(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
