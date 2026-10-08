import 'server-only';
import { _createPrivilegedClient } from '@/lib/supabase/privileged';
import { hitRateLimit } from '@/lib/repositories/rate-limit-repository';

export interface RateLimitResult {
  count: number;
  resetTime: number;
}

/**
 * Count a request against a shared (database-backed) rate limit.
 * Shared across all server instances, unlike an in-memory store.
 */
export async function consumeRateLimit(key: string, windowMs: number): Promise<RateLimitResult> {
  const { count, resetAt } = await hitRateLimit(_createPrivilegedClient(), key, windowMs, true);
  return { count, resetTime: resetAt.getTime() };
}

/**
 * Read the current count for a rate limit key without counting this request.
 */
export async function peekRateLimit(key: string, windowMs: number): Promise<RateLimitResult> {
  const { count, resetAt } = await hitRateLimit(_createPrivilegedClient(), key, windowMs, false);
  return { count, resetTime: resetAt.getTime() };
}
