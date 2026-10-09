jest.mock('@/lib/services/auth', () => ({
  authorizePublicRead: jest.fn(),
  getViewer: jest.fn(),
}));

jest.mock('@/lib/repositories/player-statistics-repository.db', () => ({
  getPlayerByNumber: jest.fn(),
  getPlayerParticipations: jest.fn(),
  getCompletedProfileData: jest.fn(),
}));

import { NotFoundError } from '@/lib/errors';
import * as playerStatsRepo from '@/lib/repositories/player-statistics-repository.db';
import { authorizePublicRead, getViewer } from '@/lib/services/auth';
import { getPlayerProfile } from '../player-statistics/player-statistics-service';

describe('Player Statistics Service', () => {
  const pg = { kind: 'test-pg' };

  beforeEach(() => {
    jest.clearAllMocks();
    (authorizePublicRead as jest.Mock).mockReturnValue({ pg });
    (getViewer as jest.Mock).mockResolvedValue(null);
    (playerStatsRepo.getCompletedProfileData as jest.Mock).mockResolvedValue({
      frameResults: [],
      placements: [],
      matchRecordsByTeam: new Map(),
    });
  });

  it('calculates placement statistics once per event when team ids are reused', async () => {
    (playerStatsRepo.getPlayerByNumber as jest.Mock).mockResolvedValue({
      id: 'player-uuid', player_number: 123, full_name: 'Test Player',
      created_at: '2024-01-01T00:00:00.000Z',
    });
    const teamInfoMap = new Map([
      ['ep1', { teamId: 't1', eventPlayerId: 'ep1' }],
      ['ep2', { teamId: 't1', eventPlayerId: 'ep2' }],
    ]);
    (playerStatsRepo.getPlayerParticipations as jest.Mock).mockResolvedValue({
      participations: [
        { eventPlayerId: 'ep1', eventId: 'e1', eventDate: '2024-01-01', leagueId: 'l1', leagueName: 'L1', eventStatus: 'completed' },
        { eventPlayerId: 'ep2', eventId: 'e2', eventDate: '2024-01-08', leagueId: 'l1', leagueName: 'L1', eventStatus: 'completed' },
      ],
      teamInfoMap,
    });
    (playerStatsRepo.getCompletedProfileData as jest.Mock).mockResolvedValue({
      frameResults: [],
      placements: [
        { eventId: 'e1', teamId: 't1', placement: 1 },
        { eventId: 'e2', teamId: 't1', placement: 2 },
      ],
      matchRecordsByTeam: new Map(),
    });

    const profile = await getPlayerProfile(123);

    expect(profile.statistics).toMatchObject({
      eventsPlayed: 2, firstPlaceFinishes: 1, topThreeFinishes: 2,
    });
  });

  it('passes the viewer id to the visibility-filtered participation query', async () => {
    (getViewer as jest.Mock).mockResolvedValue({ id: 'viewer-id' });
    (playerStatsRepo.getPlayerByNumber as jest.Mock).mockResolvedValue({
      id: 'p1', player_number: 1, full_name: 'Private Only',
      created_at: '2024-01-01T00:00:00.000Z',
    });
    // The repository SQL filters this player's only, private event.
    (playerStatsRepo.getPlayerParticipations as jest.Mock).mockResolvedValue({
      participations: [], teamInfoMap: new Map(),
    });

    const profile = await getPlayerProfile(1);

    expect(playerStatsRepo.getPlayerParticipations).toHaveBeenCalledWith(pg, 'p1', 'viewer-id');
    expect(profile.statistics.eventsPlayed).toBe(0);
    expect(profile.eventHistory).toEqual([]);
    expect(profile.ongoingEvents).toEqual([]);
    expect(playerStatsRepo.getCompletedProfileData).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for an unknown player number', async () => {
    (playerStatsRepo.getPlayerByNumber as jest.Mock).mockResolvedValue(null);

    await expect(getPlayerProfile(999999)).rejects.toBeInstanceOf(NotFoundError);
    expect(playerStatsRepo.getPlayerParticipations).not.toHaveBeenCalled();
  });
});
