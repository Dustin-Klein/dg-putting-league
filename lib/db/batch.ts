/**
 * Row limit for one multi-row statement. Postgres allows 65535 bind parameters per
 * statement; the widest batched insert (bracket_match, 10 columns) stays well under
 * that at this size, and so do the payloads. Larger inputs are split into several
 * statements inside the caller's transaction.
 */
export const MAX_BATCH_ROWS = 1000;

/** Split `rows` into consecutive chunks of at most `size` rows. */
export function chunks<T>(rows: readonly T[], size = MAX_BATCH_ROWS): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    result.push(rows.slice(i, i + size));
  }
  return result;
}
