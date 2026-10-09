import 'server-only';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { rate_limits } from '@/lib/db/schema';

export interface RateLimitCounter {
  count: number;
  resetAt: Date;
}

/**
 * Atomically count a request against a fixed-window rate limit key (one upsert).
 * With `increment: false` the current window is read without counting.
 */
export async function hitRateLimit(
  ex: Executor,
  key: string,
  windowMs: number,
  increment = true
): Promise<RateLimitCounter> {
  // Opportunistic cleanup of long-expired windows
  if (Math.random() < 0.01) {
    await ex.delete(rate_limits).where(lt(rate_limits.reset_at, sql`now() - interval '1 hour'`));
  }

  if (!increment) {
    const rows = await ex
      .select({ count: rate_limits.count, reset_at: rate_limits.reset_at })
      .from(rate_limits)
      .where(and(eq(rate_limits.key, key), gt(rate_limits.reset_at, sql`now()`)));
    const row = rows[0];
    return row
      ? { count: row.count, resetAt: new Date(row.reset_at) }
      : { count: 0, resetAt: new Date(Date.now() + windowMs) };
  }

  const windowEnd = sql`now() + make_interval(secs => ${windowMs / 1000})`;
  const [row] = await ex
    .insert(rate_limits)
    .values({ key, count: 1, reset_at: windowEnd })
    .onConflictDoUpdate({
      target: rate_limits.key,
      set: {
        count: sql`case when ${rate_limits.reset_at} <= now() then 1 else ${rate_limits.count} + 1 end`,
        reset_at: sql`case when ${rate_limits.reset_at} <= now() then excluded.reset_at else ${rate_limits.reset_at} end`,
      },
    })
    .returning({ count: rate_limits.count, reset_at: rate_limits.reset_at });

  return { count: row.count, resetAt: new Date(row.reset_at) };
}
