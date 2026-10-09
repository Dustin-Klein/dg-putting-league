import type { SupabaseClient } from '@supabase/supabase-js';
import { InternalError } from '@/lib/errors';

export interface RateLimitCounter {
  count: number;
  resetAt: Date;
}

/**
 * Atomically count a request against a fixed-window rate limit key.
 * With `increment: false` the current window is read without counting.
 */
export async function hitRateLimit(
  supabase: SupabaseClient,
  key: string,
  windowMs: number,
  increment = true
): Promise<RateLimitCounter> {
  const { data, error } = await supabase.rpc('rate_limit_hit', {
    p_key: key,
    p_window_ms: windowMs,
    p_increment: increment,
  });

  if (error) {
    throw new InternalError(`Failed to update rate limit: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as { count: number; reset_at: string } | null;
  if (!row) {
    return { count: 0, resetAt: new Date(Date.now() + windowMs) };
  }

  return { count: row.count, resetAt: new Date(row.reset_at) };
}
