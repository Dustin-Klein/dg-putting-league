/**
 * Rate limit middleware tests (store is mocked; see rate_limit_hit in the
 * security lockdown migration for the shared Postgres counter).
 */

import { InvalidAccessCodeError, NotFoundError } from '@/lib/errors';

jest.mock('@/lib/services/auth/rate-limit-service', () => ({
  consumeRateLimit: jest.fn(),
  peekRateLimit: jest.fn(),
}));

jest.mock('@/lib/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { consumeRateLimit, peekRateLimit } from '@/lib/services/auth/rate-limit-service';
import {
  withRateLimit,
  withStrictRateLimit,
  withScoringRateLimit,
  recordAccessCodeFailure,
} from '../rate-limit';

function makeRequest(ip = '203.0.113.7'): Request {
  return new Request('http://localhost/api/score', {
    method: 'POST',
    headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
  });
}

describe('rate-limit middleware', () => {
  const resetTime = Date.now() + 30_000;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keys the counter by client IP and route', async () => {
    (consumeRateLimit as jest.Mock).mockResolvedValue({ count: 1, resetTime });

    await expect(withRateLimit(makeRequest(), 'players:search')).resolves.toBeNull();
    expect(consumeRateLimit).toHaveBeenCalledWith('203.0.113.7:players:search', 60_000);
  });

  it('returns 429 with Retry-After once the limit is exceeded', async () => {
    (consumeRateLimit as jest.Mock).mockResolvedValue({ count: 11, resetTime });

    const response = await withStrictRateLimit(makeRequest(), 'league:create');

    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('allows exactly maxRequests requests', async () => {
    (consumeRateLimit as jest.Mock).mockResolvedValue({ count: 10, resetTime });

    await expect(withStrictRateLimit(makeRequest(), 'league:create')).resolves.toBeNull();
  });

  it('fails open when the store is unavailable', async () => {
    (consumeRateLimit as jest.Mock).mockRejectedValue(new Error('connection refused'));

    await expect(withRateLimit(makeRequest(), 'public:leagues')).resolves.toBeNull();
  });

  describe('scoring routes', () => {
    it('blocks an IP with too many failed access codes', async () => {
      (peekRateLimit as jest.Mock).mockResolvedValue({ count: 10, resetTime });

      const response = await withScoringRateLimit(makeRequest());

      expect(response?.status).toBe(429);
      expect(consumeRateLimit).not.toHaveBeenCalled();
    });

    it('applies the shared scoring limit otherwise', async () => {
      (peekRateLimit as jest.Mock).mockResolvedValue({ count: 3, resetTime });
      (consumeRateLimit as jest.Mock).mockResolvedValue({ count: 1, resetTime });

      await expect(withScoringRateLimit(makeRequest())).resolves.toBeNull();
      expect(consumeRateLimit).toHaveBeenCalledWith('203.0.113.7:score', 60_000);
    });

    it('records only invalid access codes as failures', async () => {
      (consumeRateLimit as jest.Mock).mockResolvedValue({ count: 1, resetTime });

      await recordAccessCodeFailure(makeRequest(), new NotFoundError('Match not found'));
      expect(consumeRateLimit).not.toHaveBeenCalled();

      await recordAccessCodeFailure(makeRequest(), new InvalidAccessCodeError());
      expect(consumeRateLimit).toHaveBeenCalledWith(
        '203.0.113.7:score:access-code-failure',
        60_000
      );
    });
  });
});
