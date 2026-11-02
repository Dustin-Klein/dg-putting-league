import { ForbiddenError, NotFoundError, UnauthorizedError } from '@/lib/errors';

jest.mock('@/lib/services/auth', () => ({
  authorizeLeagueAdmin: jest.fn(),
  authorizeEventAdmin: jest.fn(),
  authorizePublicRead: jest.fn(() => ({ pg: { kind: 'pg' } })),
  getViewer: jest.fn(async () => null),
}));
jest.mock('@/lib/db/tx', () => ({
  withTransaction: jest.fn(async (pg, fn) => fn(pg)),
  lockEvent: jest.fn(),
  lockLeagueHandicap: jest.fn(),
}));
jest.mock('@/lib/repositories/handicap-repository.db');
jest.mock('@/lib/repositories/event-repository.db');
jest.mock('@/lib/repositories/league-repository.db');
jest.mock('@/lib/repositories/player-statistics-repository.db');

import { authorizeEventAdmin, authorizeLeagueAdmin } from '@/lib/services/auth';
import * as handicapDb from '@/lib/repositories/handicap-repository.db';
import { getLeagueById } from '@/lib/repositories/league-repository.db';
import {
  getEventHandicap,
  getHandicapSettings,
  updateEntryHandicap,
  updateEventZoneDistances,
  updateHandicapSettings,
} from '../settings-service';
import {
  getLeagueHandicapRoster,
  getPlayerHandicap,
  listZoneSuggestions,
  moveEntryZone,
  resolveZoneSuggestion,
  setPlayerZone,
} from '../zone-service';
import { DEFAULT_HANDICAP_SETTINGS } from '@/lib/types/handicap';

const LEAGUE = '00000000-0000-4000-8000-000000000001';
const PLAYER = '00000000-0000-4000-8000-000000000002';
const EVENT = '00000000-0000-4000-8000-000000000003';
const EVALUATION = '00000000-0000-4000-8000-000000000004';

function repoCalls(): number {
  return Object.values(handicapDb).filter((fn) => jest.isMockFunction(fn))
    .reduce((total, fn) => total + (fn as jest.Mock).mock.calls.length, 0);
}

describe('handicap services refuse unauthorized callers before touching the database', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authorizeLeagueAdmin as jest.Mock).mockRejectedValue(new ForbiddenError('Insufficient permissions'));
    (authorizeEventAdmin as jest.Mock).mockRejectedValue(new UnauthorizedError('Authentication required'));
  });

  it.each([
    ['getHandicapSettings', () => getHandicapSettings(LEAGUE)],
    ['updateHandicapSettings', () => updateHandicapSettings(LEAGUE, { settings: DEFAULT_HANDICAP_SETTINGS })],
    ['getLeagueHandicapRoster', () => getLeagueHandicapRoster(LEAGUE)],
    ['listZoneSuggestions', () => listZoneSuggestions(LEAGUE)],
    ['setPlayerZone', () => setPlayerZone(LEAGUE, PLAYER, 2, 'note')],
    ['resolveZoneSuggestion', () => resolveZoneSuggestion(LEAGUE, EVALUATION, 'dismiss', 'note')],
  ])('%s requires a league admin', async (_name, call) => {
    await expect(call()).rejects.toThrow(ForbiddenError);
    expect(repoCalls()).toBe(0);
  });

  it.each([
    ['getEventHandicap', () => getEventHandicap(EVENT)],
    ['updateEventZoneDistances', () => updateEventZoneDistances(EVENT, [])],
    ['updateEntryHandicap', () => updateEntryHandicap(EVENT, PLAYER, { exclude_from_handicap: true })],
    ['moveEntryZone', () => moveEntryZone(EVENT, PLAYER, 3, 'note')],
  ])('%s requires an event admin', async (_name, call) => {
    await expect(call()).rejects.toThrow(UnauthorizedError);
    expect(repoCalls()).toBe(0);
  });

  it('getPlayerHandicap hides a league without a handicap record', async () => {
    (getLeagueById as jest.Mock).mockResolvedValue({ id: LEAGUE, name: 'League' });
    (handicapDb.getLeagueHandicapSettings as jest.Mock).mockResolvedValue(null);
    (handicapDb.getLeagueZones as jest.Mock).mockResolvedValue([]);
    (handicapDb.getPeriodHistory as jest.Mock).mockResolvedValue([]);
    await expect(getPlayerHandicap(PLAYER, LEAGUE)).rejects.toThrow(NotFoundError);
    await expect(getPlayerHandicap('not-a-uuid', LEAGUE)).rejects.toThrow(NotFoundError);
  });
});
