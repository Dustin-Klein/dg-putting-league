import { NextRequest } from 'next/server';
import { GET as getSummary } from '@/app/api/event/[eventId]/second-chance/route';
import { GET as getRoster, POST as sync } from '@/app/api/event/[eventId]/second-chance/roster/route';
import { getSecondChanceRoster, getSecondChanceSummary, syncSecondChancePlayers } from '@/lib/services/event';
import { BadRequestError } from '@/lib/errors';

jest.mock('@/lib/services/event', () => ({
  createSecondChanceEvent: jest.fn(),
  getSecondChanceSummary: jest.fn(),
  getSecondChanceRoster: jest.fn(),
  syncSecondChancePlayers: jest.fn(),
}));
jest.mock('@/lib/middleware/rate-limit', () => ({ withRateLimit: jest.fn(async () => null) }));
jest.mock('@/lib/utils/request-id', () => ({ getRequestId: jest.fn() }));

const request = (method: string, body?: string) =>
  new NextRequest('http://localhost/api/event/e1/second-chance/roster', { method, body });
const params = { params: Promise.resolve({ eventId: 'e1' }) };

describe('second-chance read and sync routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the main event summary', async () => {
    jest.mocked(getSecondChanceSummary).mockResolvedValue({ status: 'bracket', eliminated_count: 3, child: null, can_create: true, zones_available: false });
    const response = await getSummary(request('GET'), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ eliminated_count: 3 });
    expect(getSecondChanceSummary).toHaveBeenCalledWith('e1');
  });

  it('returns the roster and syncs through the service', async () => {
    const roster = { parent_event_id: 'p', parent_status: 'bracket' as const, status: 'created' as const, pending: [], not_eliminated: [], can_sync: true };
    jest.mocked(getSecondChanceRoster).mockResolvedValue(roster);
    jest.mocked(syncSecondChancePlayers).mockResolvedValue({ ...roster, added: 2 });
    expect(await (await getRoster(request('GET'), params)).json()).toEqual(roster);
    const synced = await sync(request('POST'), params);
    expect(synced.status).toBe(200);
    expect(await synced.json()).toMatchObject({ added: 2 });
    expect(syncSecondChancePlayers).toHaveBeenCalledWith('e1', undefined);
  });

  it('adds one player when player_id is given', async () => {
    const playerId = '6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';
    jest.mocked(syncSecondChancePlayers).mockResolvedValue({ parent_event_id: 'p', parent_status: 'bracket', status: 'created', pending: [], not_eliminated: [], can_sync: true, added: 1 });
    const response = await sync(request('POST', JSON.stringify({ player_id: playerId })), params);
    expect(response.status).toBe(200);
    expect(syncSecondChancePlayers).toHaveBeenCalledWith('e1', playerId);
  });

  it('rejects an invalid player_id or body', async () => {
    expect((await sync(request('POST', JSON.stringify({ player_id: 'nope' })), params)).status).toBe(400);
    expect((await sync(request('POST', '{'), params)).status).toBe(400);
    expect(syncSecondChancePlayers).not.toHaveBeenCalled();
  });

  it('maps service errors to client errors', async () => {
    jest.mocked(syncSecondChancePlayers).mockRejectedValue(new BadRequestError('This is not a second-chance event'));
    const response = await sync(request('POST'), params);
    expect(response.status).toBe(400);
  });
});
