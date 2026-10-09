import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { hitRateLimit } from '@/lib/repositories/rate-limit-repository';

export interface RateLimitResult {
  count: number;
  resetTime: number;
}

function createRateLimitClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error('SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_URL must be set');
  }
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Count a request against a shared (database-backed) rate limit.
 * Shared across all server instances, unlike an in-memory store.
 */
export async function consumeRateLimit(key: string, windowMs: number): Promise<RateLimitResult> {
  const { count, resetAt } = await hitRateLimit(createRateLimitClient(), key, windowMs, true);
  return { count, resetTime: resetAt.getTime() };
}

/**
 * Read the current count for a rate limit key without counting this request.
 */
export async function peekRateLimit(key: string, windowMs: number): Promise<RateLimitResult> {
  const { count, resetAt } = await hitRateLimit(createRateLimitClient(), key, windowMs, false);
  return { count, resetTime: resetAt.getTime() };
}
