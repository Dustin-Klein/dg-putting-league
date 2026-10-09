import 'server-only';
import { _getDb } from '@/lib/db/client';
import { hitRateLimit } from '@/lib/repositories/rate-limit-repository.db';

export interface RateLimitResult {
  count: number;
  resetTime: number;
}

/**
 * Count a request against a shared (database-backed) rate limit.
 * Shared across all server instances, unlike an in-memory store.
 */
export async function consumeRateLimit(key: string, windowMs: number): Promise<RateLimitResult> {
  const { count, resetAt } = await hitRateLimit(_getDb(), key, windowMs, true);
  return { count, resetTime: resetAt.getTime() };
}

/**
 * Read the current count for a rate limit key without counting this request.
 */
export async function peekRateLimit(key: string, windowMs: number): Promise<RateLimitResult> {
  const { count, resetAt } = await hitRateLimit(_getDb(), key, windowMs, false);
  return { count, resetTime: resetAt.getTime() };
}
