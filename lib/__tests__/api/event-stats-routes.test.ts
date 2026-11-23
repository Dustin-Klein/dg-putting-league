import { NextRequest } from 'next/server';
import { GET as publicGet } from '@/app/api/public/event/[eventId]/stats/route';
import { GET as adminGet } from '@/app/api/event/[eventId]/stats/route';
import { getAdminEventStats, getPublicEventStats } from '@/lib/services/event-stats';
import { withPublicStatsRateLimit } from '@/lib/middleware/rate-limit';
import { NotFoundError } from '@/lib/errors';

jest.mock('@/lib/services/event-stats', () => ({ getPublicEventStats: jest.fn(), getAdminEventStats: jest.fn() }));
jest.mock('@/lib/middleware/rate-limit', () => ({ withPublicStatsRateLimit: jest.fn(async () => null) }));
jest.mock('@/lib/utils/request-id', () => ({ getRequestId: jest.fn() }));

const params = { params: Promise.resolve({ eventId: 'e1' }) };

describe('event stats routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rate-limits the public route before reading', async () => {
    const { NextResponse } = await import('next/server');
    jest.mocked(withPublicStatsRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    const response = await publicGet(new NextRequest('http://localhost/api/public/event/e1/stats'), params);
    expect(response.status).toBe(429);
    expect(getPublicEventStats).not.toHaveBeenCalled();
  });

  it('maps a hidden event to 404', async () => {
    jest.mocked(getPublicEventStats).mockRejectedValue(new NotFoundError('Event not found'));
    const response = await publicGet(new NextRequest('http://localhost/api/public/event/e1/stats'), params);
    expect(response.status).toBe(404);
  });

  it('sends the admin report with no-store', async () => {
    jest.mocked(getAdminEventStats).mockResolvedValue({ event: {} } as never);
    const response = await adminGet(new NextRequest('http://localhost/api/event/e1/stats'), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
