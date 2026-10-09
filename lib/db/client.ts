import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

declare const dbBrand: unique symbol;

/**
 * Direct Postgres connection for the Next.js server (role `app_server`, bypasses RLS).
 *
 * Branded so services obtain it only through the `authorize*` functions
 * in `lib/services/auth`, which perform the authorization check first.
 */
export type Db = PostgresJsDatabase<typeof schema> & {
  $client: postgres.Sql;
  readonly [dbBrand]: 'app-db';
};

function createDb(url: string, max = Number(process.env.DATABASE_POOL_MAX ?? 3)): Db {
  // Supavisor transaction mode (port 6543) doesn't support prepared statements.
  // Each serverless instance keeps a small pool; the pooler multiplexes them.
  const client = postgres(url, {
    prepare: false,
    max,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(client, { schema }) as unknown as Db;
}

// Cached on globalThis so dev HMR and warm serverless instances reuse one pool.
const globalForDb = globalThis as unknown as { __appDb?: Db };

/**
 * Do not import this outside `lib/services/auth` and `lib/db` (enforced by ESLint).
 */
export function _getDb(): Db {
  if (!globalForDb.__appDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL must be set');
    }
    globalForDb.__appDb = createDb(url);
  }
  return globalForDb.__appDb;
}

/**
 * Create a standalone connection (integration tests and scripts). Close it with
 * `closeDb` when done.
 */
export function _createDbForTests(url: string, opts: { max?: number } = {}): Db {
  return createDb(url, opts.max);
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end({ timeout: 5 });
}
