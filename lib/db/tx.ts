import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { bracket_match } from './schema';

export type { Db } from './client';
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Repositories take an Executor so they work inside or outside a transaction. */
export type Executor = Db | Tx;

/**
 * Run `fn` in one database transaction. Services own transactions; repositories never
 * open their own. Throwing inside `fn` rolls everything back. Given a transaction
 * instead of the Db, it runs `fn` in a savepoint (integration tests rely on this).
 *
 * Lock order (prevents deadlocks): event advisory lock → match rows (ascending id)
 * → lane rows (ascending id).
 */
export function withTransaction<T>(
  ex: Executor,
  fn: (tx: Tx) => Promise<T>,
  opts?: { isolationLevel?: 'read committed' | 'serializable' }
): Promise<T> {
  if ('rollback' in ex) {
    return ex.transaction(fn);
  }
  return ex.transaction(fn, opts);
}

/**
 * Serialize bracket-structure and lane mutations for one event until the transaction
 * ends. Transaction-scoped, so it's safe behind a transaction-mode pooler.
 */
export async function lockEvent(tx: Tx, eventId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'event:' + eventId}, 0))`);
}

export type LockedMatch = typeof bracket_match.$inferSelect;

/**
 * Lock a match row (`SELECT … FOR UPDATE`) and return it, or null when the match
 * doesn't exist or belongs to another event.
 */
export async function lockMatch(
  tx: Tx,
  matchId: number,
  eventId: string
): Promise<LockedMatch | null> {
  const rows = await tx
    .select()
    .from(bracket_match)
    .where(and(eq(bracket_match.id, matchId), eq(bracket_match.event_id, eventId)))
    .for('update');
  return rows[0] ?? null;
}
