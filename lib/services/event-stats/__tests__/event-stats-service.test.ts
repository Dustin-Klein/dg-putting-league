jest.mock('@/lib/services/auth/auth-service', () => ({
  authorizeEventView: jest.fn(),
  authorizeEventAdmin: jest.fn(),
}));
jest.mock('@/lib/repositories/event-stats-repository.db', () => ({
  getEventStatsSnapshot: jest.fn(),
  getEventStatsAdminData: jest.fn(),
  getSeasonCounts: jest.fn(async () => []),
  getFieldSeasonCounts: jest.fn(async () => []),
  getLeagueHistoryEntries: jest.fn(async () => []),
}));
jest.mock('@/lib/repositories/handicap-repository.db', () => ({ getEventEvaluations: jest.fn(async () => []) }));

import { authorizeEventAdmin, authorizeEventView } from '@/lib/services/auth/auth-service';
import * as statsDb from '@/lib/repositories/event-stats-repository.db';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { _clearEventStatsCaches, getAdminEventStats, getPublicEventStats } from '../event-stats-service';
import { snapshot } from './fixtures';

const pg = { transaction: (fn: (tx: unknown) => unknown) => fn({}) };
const access = (status: string) => ({ id: 'event-1', league_id: 'l', status, qualification_round_enabled: true, admin_role: null });

describe('event stats service authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearEventStatsCaches();
    jest.mocked(statsDb.getEventStatsSnapshot).mockResolvedValue(snapshot({ matches: [] }));
  });

  it('rejects public reads the visibility rules refuse', async () => {
    jest.mocked(authorizeEventView).mockRejectedValue(new NotFoundError('Event not found'));
    await expect(getPublicEventStats('event-1')).rejects.toThrow(NotFoundError);
    expect(statsDb.getEventStatsSnapshot).not.toHaveBeenCalled();
  });

  it('refuses the public report before bracket play, even for admins', async () => {
    jest.mocked(authorizeEventView).mockResolvedValue({ user: null, event: access('pre-bracket'), isAdmin: true, pg } as never);
    await expect(getPublicEventStats('event-1')).rejects.toThrow(NotFoundError);
    expect(authorizeEventView).toHaveBeenCalledWith('event-1', 'bracket');
  });

  it('authorizes every request, then serves the cached report', async () => {
    jest.mocked(authorizeEventView).mockResolvedValue({ user: null, event: access('bracket'), isAdmin: false, pg } as never);
    await getPublicEventStats('event-1');
    await getPublicEventStats('event-1');
    expect(authorizeEventView).toHaveBeenCalledTimes(2);
    expect(statsDb.getEventStatsSnapshot).toHaveBeenCalledTimes(1);
  });

  it('rejects non-admins from the admin report', async () => {
    jest.mocked(authorizeEventAdmin).mockRejectedValue(new ForbiddenError('Insufficient permissions'));
    await expect(getAdminEventStats('event-1')).rejects.toThrow(ForbiddenError);
    expect(statsDb.getEventStatsSnapshot).not.toHaveBeenCalled();
  });

  it('never caches the admin report', async () => {
    jest.mocked(authorizeEventAdmin).mockResolvedValue({ user: { id: 'u' }, event: access('bracket'), pg } as never);
    jest.mocked(statsDb.getEventStatsAdminData).mockResolvedValue({ entries: [], hasQualificationRound: false });
    await getAdminEventStats('event-1');
    await getAdminEventStats('event-1');
    expect(statsDb.getEventStatsSnapshot).toHaveBeenCalledTimes(2);
  });
});
