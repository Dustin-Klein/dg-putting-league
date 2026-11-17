import { NextRequest } from 'next/server';
import { POST as createEventRoute } from '@/app/api/league/[leagueId]/route';
import { PATCH as updateEventRoute } from '@/app/api/event/[eventId]/route';
import { createEvent, updateEventSettings } from '@/lib/services/event';

jest.mock('@/lib/services/event', () => ({
  createEvent: jest.fn(),
  updateEventSettings: jest.fn(),
  getEventForViewer: jest.fn(),
  deleteEvent: jest.fn(),
}));
jest.mock('@/lib/services/league', () => ({ deleteLeague: jest.fn() }));
jest.mock('@/lib/middleware/rate-limit', () => ({ withStrictRateLimit: jest.fn(async () => null) }));
jest.mock('@/lib/utils/request-id', () => ({ getRequestId: jest.fn() }));
jest.mock('@/lib/utils', () => ({ validateCsrfOrigin: jest.fn() }));

const baseEvent = {
  event_date: '2026-12-01',
  location: null,
  lane_count: 4,
  putt_distance_ft: 15,
  access_code: 'abc123',
};

function post(body: unknown) {
  return createEventRoute(
    new Request('http://localhost/api/league/league-1', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ leagueId: 'league-1' }) }
  );
}

function patch(body: unknown) {
  return updateEventRoute(
    new NextRequest('http://localhost/api/event/event-1', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ eventId: 'event-1' }) }
  );
}

describe('bracket format on event routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(createEvent).mockResolvedValue({ id: 'event-1' } as Awaited<ReturnType<typeof createEvent>>);
    jest.mocked(updateEventSettings).mockResolvedValue({ id: 'event-1' } as Awaited<ReturnType<typeof updateEventSettings>>);
  });

  it('passes the format through on create without defaulting a double grand final', async () => {
    const response = await post({ ...baseEvent, bracket_format: 'single_elimination', third_place_match: true });
    expect(response.status).toBe(201);
    const input = jest.mocked(createEvent).mock.calls[0][0];
    expect(input).toMatchObject({ bracket_format: 'single_elimination', third_place_match: true });
    expect(input.double_grand_final).toBeUndefined();
  });

  it('rejects an unknown format on create', async () => {
    expect((await post({ ...baseEvent, bracket_format: 'round_robin' })).status).toBe(400);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('passes format changes through on update', async () => {
    expect((await patch({ bracket_format: 'single_elimination', third_place_match: false })).status).toBe(200);
    expect(updateEventSettings).toHaveBeenCalledWith('event-1', { bracket_format: 'single_elimination', third_place_match: false });
  });
});
