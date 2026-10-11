import { NextRequest } from 'next/server';
import { POST } from '@/app/api/event/[eventId]/second-chance/route';
import { createSecondChanceEvent } from '@/lib/services/event';

jest.mock('@/lib/services/event', () => ({ createSecondChanceEvent: jest.fn() }));
jest.mock('@/lib/middleware/rate-limit', () => ({ withStrictRateLimit: jest.fn(async () => null) }));
jest.mock('@/lib/utils/request-id', () => ({ getRequestId: jest.fn() }));

function submit(body: string) {
  return POST(new NextRequest('http://localhost/api/event/parent/second-chance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }), { params: Promise.resolve({ eventId: 'parent' }) });
}

describe('second-chance request validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['2026-02-30', '2026-02-29', '2026-04-31'])('rejects impossible date %s before creating an event', async (event_date) => {
    const response = await submit(JSON.stringify({ access_code: 'second123', event_date }));
    expect(response.status).toBe(400);
    expect(createSecondChanceEvent).not.toHaveBeenCalled();
  });

  it('accepts a leap day and calls the service with the parsed input', async () => {
    const input = { access_code: 'second123', event_date: '2028-02-29' };
    jest.mocked(createSecondChanceEvent).mockResolvedValue({ id: 'child' } as Awaited<ReturnType<typeof createSecondChanceEvent>>);
    expect((await submit(JSON.stringify(input))).status).toBe(201);
    expect(createSecondChanceEvent).toHaveBeenCalledWith('parent', input);
  });

  it('returns a client error for malformed JSON', async () => {
    const response = await submit('{');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
    expect(createSecondChanceEvent).not.toHaveBeenCalled();
  });
});
