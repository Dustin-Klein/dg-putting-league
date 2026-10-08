import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { consumeRateLimit, peekRateLimit } from '@/lib/services/auth/rate-limit-service';
import { InvalidAccessCodeError } from '@/lib/errors';
import { logger } from '@/lib/utils/logger';

// Counters live in Postgres (public.rate_limits) so limits hold across serverless
// instances. If the store is unreachable, requests are allowed (fail open) and the
// failure is logged: rate limiting must not take scoring down with it.

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const defaultConfig: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60, // 60 requests per minute
};

const strictConfig: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10, // 10 requests per minute for sensitive operations
};

/**
 * Public scoring traffic. Scorers at a venue often share one IP (venue Wi-Fi),
 * and every scorer page load and frame save is a request, so this is generous.
 * Access-code guessing is limited separately by failed attempts.
 */
const scoringConfig: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 300,
};

/** Failed access-code attempts per IP. */
const accessCodeFailureConfig: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 10,
};

function getClientIp(request: Request): string {
  // request.ip is available on Vercel/Edge runtime but not in all environments
  const ip = (request as NextRequest & { ip?: string }).ip;
  if (ip) {
    return ip;
  }
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  return 'unknown';
}

export async function checkRateLimit(
  request: Request,
  routeKey: string,
  config: RateLimitConfig = defaultConfig
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const key = `${getClientIp(request)}:${routeKey}`;

  try {
    const { count, resetTime } = await consumeRateLimit(key, config.windowMs);
    return {
      allowed: count <= config.maxRequests,
      remaining: Math.max(0, config.maxRequests - count),
      resetTime,
    };
  } catch (error) {
    logger.warn('Rate limit store unavailable; allowing request', {
      routeKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return { allowed: true, remaining: config.maxRequests, resetTime: Date.now() + config.windowMs };
  }
}

export function rateLimitResponse(resetTime: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
      },
    }
  );
}

export async function withRateLimit(
  request: Request,
  routeKey: string,
  config: RateLimitConfig = defaultConfig
): Promise<NextResponse | null> {
  const result = await checkRateLimit(request, routeKey, config);
  if (!result.allowed) {
    return rateLimitResponse(result.resetTime);
  }
  return null;
}

export async function withStrictRateLimit(
  request: Request,
  routeKey: string
): Promise<NextResponse | null> {
  return withRateLimit(request, routeKey, strictConfig);
}

const ACCESS_CODE_FAILURE_KEY = 'score:access-code-failure';

/**
 * Rate limit for access-code (public scoring) routes:
 * - all requests count against a generous shared scoring limit, and
 * - an IP with too many recent failed access codes is blocked until the window resets.
 * Pair with `recordAccessCodeFailure` in the route's error handler.
 */
export async function withScoringRateLimit(request: Request): Promise<NextResponse | null> {
  const key = `${getClientIp(request)}:${ACCESS_CODE_FAILURE_KEY}`;
  try {
    const failures = await peekRateLimit(key, accessCodeFailureConfig.windowMs);
    if (failures.count >= accessCodeFailureConfig.maxRequests) {
      return rateLimitResponse(failures.resetTime);
    }
  } catch (error) {
    logger.warn('Rate limit store unavailable; allowing request', {
      routeKey: ACCESS_CODE_FAILURE_KEY,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return withRateLimit(request, 'score', scoringConfig);
}

/**
 * Count a failed access-code attempt against the caller's IP. No-op for other errors.
 */
export async function recordAccessCodeFailure(request: Request, error: unknown): Promise<void> {
  if (!(error instanceof InvalidAccessCodeError)) {
    return;
  }
  await checkRateLimit(request, ACCESS_CODE_FAILURE_KEY, accessCodeFailureConfig);
}
