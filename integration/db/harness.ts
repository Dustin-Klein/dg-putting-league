/**
 * Integration-test access to a real Postgres (local Supabase: `supabase start`).
 *
 * Tests connect as `app_server`, the role the app uses, so missing grants fail here
 * too. Override with TEST_DATABASE_URL.
 */
import { _createDbForTests, closeDb, type Db } from '@/lib/db/client';
import type { Tx } from '@/lib/db/tx';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://app_server:app_server@127.0.0.1:54322/postgres';

export function createTestDb(max = 10): Db {
  return _createDbForTests(TEST_DATABASE_URL, { max });
}

export { closeDb };

class Rollback extends Error {}

/**
 * Run `fn` in a transaction that is always rolled back. Services called with the
 * transaction run their own transactions as savepoints inside it.
 */
export async function withRollback(db: Db, fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/**
 * A test Db that counts the statements the driver sends. `count()` runs `fn` and
 * returns how many statements it issued (savepoints included).
 */
export function createCountingTestDb(): {
  db: Db;
  count: (fn: () => Promise<unknown>) => Promise<{ total: number; queries: string[] }>;
} {
  let recording: string[] | null = null;
  const db = _createDbForTests(TEST_DATABASE_URL, {
    max: 1,
    onQuery: (query) => recording?.push(query),
  });
  return {
    db,
    async count(fn) {
      recording = [];
      try {
        await fn();
        return { total: recording.length, queries: recording };
      } finally {
        recording = null;
      }
    },
  };
}
