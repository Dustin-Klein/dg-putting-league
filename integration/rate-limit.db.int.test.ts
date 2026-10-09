import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { hitRateLimit } from '@/lib/repositories/rate-limit-repository.db';
import { closeDb, createTestDb, withRollback } from './db/harness';

const db = createTestDb();
afterAll(() => closeDb(db));

describe('rate limit store', () => {
  it('counts hits within a window and peeks without counting', async () => {
    await withRollback(db, async (tx) => {
      const key = `it:${randomUUID()}`;
      await expect(hitRateLimit(tx, key, 60_000, false)).resolves.toMatchObject({ count: 0 });
      await hitRateLimit(tx, key, 60_000);
      const second = await hitRateLimit(tx, key, 60_000);
      expect(second.count).toBe(2);
      expect(second.resetAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
      await expect(hitRateLimit(tx, key, 60_000, false)).resolves.toMatchObject({ count: 2 });
    });
  });

  it('starts a new window once the old one expired', async () => {
    const key = `it:${randomUUID()}`;
    await withRollback(db, async (tx) => {
      await hitRateLimit(tx, key, 1);
      // now() is fixed within a transaction, so expire the window explicitly
      await tx.execute(sql`update rate_limits set reset_at = now() - interval '1 second' where key = ${key}`);
      await expect(hitRateLimit(tx, key, 60_000)).resolves.toMatchObject({ count: 1 });
    });
  });

  it('counts concurrent hits atomically', async () => {
    const key = `it:${randomUUID()}`;
    try {
      const results = await Promise.all(Array.from({ length: 10 }, () => hitRateLimit(db, key, 60_000)));
      expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      await db.execute(sql`delete from rate_limits where key = ${key}`);
    }
  });
});
