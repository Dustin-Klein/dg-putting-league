import { BadRequestError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { createMockEvent, createMockEventPlayers, createMockEventWithDetails, createMockUser } from './test-utils';

jest.mock('@/lib/services/auth', () => ({
  authorizeEventAdmin: jest.fn(),
  authorizeEventView: jest.fn(),
  authorizeLeagueAdmin: jest.fn(),
}));
jest.mock('@/lib/repositories/event-repository.db', () => ({
  getEventWithPlayers: jest.fn(), getEventAccessCode: jest.fn(), getEventsByLeagueId: jest.fn(),
  isAccessCodeUnique: jest.fn(), getEventLeagueId: jest.fn(), createEvent: jest.fn(),
  copyEventPlayers: jest.fn(), deleteEvent: jest.fn(), getQualificationRound: jest.fn(),
  getQualificationFrameCounts: jest.fn(), getEventById: jest.fn(), updateEvent: jest.fn(),
  updateEventPayouts: jest.fn(), getEventBracketConfig: jest.fn(), updateEventSettings: jest.fn(),
}));
jest.mock('@/lib/repositories/frame-repository.db', () => ({
  getUnlinkedMatchFrameIdsForEvent: jest.fn(async () => []),
  deleteEmptyUnlinkedMatchFrames: jest.fn(),
}));
jest.mock('@/lib/db/tx', () => ({
  withTransaction: jest.fn(async (pg, fn) => fn(pg)),
  lockEvent: jest.fn(),
}));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));

import { authorizeEventAdmin, authorizeEventView, authorizeLeagueAdmin } from '@/lib/services/auth';
import * as eventDb from '@/lib/repositories/event-repository.db';
import {
  createEvent, deleteEvent, getEventForViewer, getEventsByLeagueId, getEventWithPlayers,
  requireEventAdmin, updateEvent, updateEventSettings, validateEventStatusTransition,
} from '../event/event-service';

describe('event service Drizzle port', () => {
  const pg = { kind: 'pg' };
  const user = createMockUser();

  beforeEach(() => {
    jest.clearAllMocks();
    (authorizeEventAdmin as jest.Mock).mockResolvedValue({ user, pg });
    (authorizeLeagueAdmin as jest.Mock).mockResolvedValue({ user, pg });
    (authorizeEventView as jest.Mock).mockResolvedValue({ user: null, event: {}, isAdmin: false, pg });
  });

  it('returns the database client from event-admin authorization', async () => {
    await expect(requireEventAdmin('event-1')).resolves.toEqual({ pg, user });
    expect(authorizeEventAdmin).toHaveBeenCalledWith('event-1');
  });

  it('authorizes an event read once and hides payment type from non-admins', async () => {
    const event = createMockEventWithDetails({ id: 'event-1' });
    (eventDb.getEventWithPlayers as jest.Mock).mockResolvedValue(event);
    await expect(getEventWithPlayers('event-1')).resolves.toBe(event);
    expect(authorizeEventView).toHaveBeenCalledTimes(1);
    expect(authorizeEventView).toHaveBeenCalledWith('event-1', 'event');
    expect(eventDb.getEventWithPlayers).toHaveBeenCalledWith(pg, 'event-1', { includePaymentType: false });
  });

  it('does not query event details when event-view authorization fails', async () => {
    (authorizeEventView as jest.Mock).mockRejectedValue(new NotFoundError('Event not found'));
    await expect(getEventWithPlayers('event-1')).rejects.toThrow(NotFoundError);
    expect(eventDb.getEventWithPlayers).not.toHaveBeenCalled();
  });

  it('does not query viewer fields when event-view authorization fails', async () => {
    (authorizeEventView as jest.Mock).mockRejectedValue(new NotFoundError('Event not found'));
    await expect(getEventForViewer('event-1')).rejects.toThrow(NotFoundError);
    expect(eventDb.getEventWithPlayers).not.toHaveBeenCalled();
    expect(eventDb.getEventAccessCode).not.toHaveBeenCalled();
  });

  it('includes admin-only fields using the same viewer authorization result', async () => {
    const event = createMockEventWithDetails({ id: 'event-1' });
    (authorizeEventView as jest.Mock).mockResolvedValue({ user, event: {}, isAdmin: true, pg });
    (eventDb.getEventWithPlayers as jest.Mock).mockResolvedValue(event);
    (eventDb.getEventAccessCode as jest.Mock).mockResolvedValue('secret1');
    await expect(getEventForViewer('event-1')).resolves.toMatchObject({ access_code: 'secret1' });
    expect(authorizeEventView).toHaveBeenCalledTimes(1);
    expect(eventDb.getEventWithPlayers).toHaveBeenCalledWith(pg, 'event-1', { includePaymentType: true });
  });

  it('hides access code and payment type from a public viewer', async () => {
    (eventDb.getEventWithPlayers as jest.Mock).mockResolvedValue(createMockEventWithDetails({ id: 'event-1' }));
    await expect(getEventForViewer('event-1')).resolves.toMatchObject({ access_code: null });
    expect(eventDb.getEventAccessCode).not.toHaveBeenCalled();
    expect(eventDb.getEventWithPlayers).toHaveBeenCalledWith(pg, 'event-1', { includePaymentType: false });
  });

  it('authorizes league event lists before querying', async () => {
    (eventDb.getEventsByLeagueId as jest.Mock).mockResolvedValue([]);
    await expect(getEventsByLeagueId('league-1')).resolves.toEqual([]);
    expect(authorizeLeagueAdmin).toHaveBeenCalledWith('league-1');
    expect(eventDb.getEventsByLeagueId).toHaveBeenCalledWith(pg, 'league-1');
  });

  it('does not query a league event list when authorization fails', async () => {
    (authorizeLeagueAdmin as jest.Mock).mockRejectedValue(new ForbiddenError('Insufficient permissions'));
    await expect(getEventsByLeagueId('league-1')).rejects.toThrow(ForbiddenError);
    expect(eventDb.getEventsByLeagueId).not.toHaveBeenCalled();
  });

  describe('createEvent', () => {
    const data = {
      league_id: 'league-1', event_date: '2026-10-09', location: 'Test', lane_count: 4,
      putt_distance_ft: 25, access_code: '  Code12  ', qualification_round_enabled: false,
      bracket_frame_count: 5, qualification_frame_count: 5,
    };

    beforeEach(() => {
      (eventDb.isAccessCodeUnique as jest.Mock).mockResolvedValue(true);
      (eventDb.createEvent as jest.Mock).mockResolvedValue(createMockEvent({ id: 'new-event' }));
    });

    it('creates and copies players through the same transaction executor', async () => {
      (eventDb.getEventLeagueId as jest.Mock).mockResolvedValue('league-1');
      await createEvent({ ...data, copy_players_from_event_id: 'source-event' });
      expect(eventDb.isAccessCodeUnique).toHaveBeenCalledWith(pg, 'code12');
      expect(eventDb.createEvent).toHaveBeenCalledWith(pg, expect.objectContaining({
        access_code: 'code12', entry_fee_per_player: null, admin_fees: null, admin_fee_per_player: null,
      }));
      expect(eventDb.copyEventPlayers).toHaveBeenCalledWith(pg, 'source-event', 'new-event');
    });

    it('rejects a source event from another league before inserting', async () => {
      (eventDb.getEventLeagueId as jest.Mock).mockResolvedValue('other-league');
      await expect(createEvent({ ...data, copy_players_from_event_id: 'source-event' }))
        .rejects.toThrow('Source event must belong to the same league');
      expect(eventDb.createEvent).not.toHaveBeenCalled();
    });

    it('rejects duplicate and short access codes', async () => {
      (eventDb.isAccessCodeUnique as jest.Mock).mockResolvedValue(false);
      await expect(createEvent(data)).rejects.toThrow(BadRequestError);
      await expect(createEvent({ ...data, access_code: 'short' })).rejects.toThrow(BadRequestError);
    });

    it('stores the team format and rejects random pairing above doubles', async () => {
      await createEvent({ ...data, team_size: 3, team_assignment: 'random_flat' });
      expect(eventDb.createEvent).toHaveBeenCalledWith(pg, expect.objectContaining({
        team_size: 3, team_assignment: 'random_flat',
      }));
      await expect(createEvent({ ...data, team_size: 3, team_assignment: 'random_pairing' }))
        .rejects.toThrow(/use a flat random draw/);
    });
  });

  describe('updateEventSettings team format', () => {
    const config = { status: 'pre-bracket', team_size: 2, team_assignment: 'random_pairing', double_grand_final: true };

    beforeEach(() => {
      (eventDb.getEventWithPlayers as jest.Mock).mockResolvedValue(createMockEventWithDetails({ status: 'pre-bracket' }));
      (eventDb.getEventById as jest.Mock).mockResolvedValue(createMockEvent());
    });

    it('changes the format before bracket play', async () => {
      (eventDb.getEventBracketConfig as jest.Mock).mockResolvedValue(config);
      await updateEventSettings('event-1', { team_size: 1 });
      expect(eventDb.updateEventSettings).toHaveBeenCalledWith(pg, 'event-1', { team_size: 1 });
    });

    it('validates the merged format', async () => {
      (eventDb.getEventBracketConfig as jest.Mock).mockResolvedValue({ ...config, team_size: 3, team_assignment: 'manual' });
      await expect(updateEventSettings('event-1', { team_assignment: 'random_pairing' }))
        .rejects.toThrow(/use a flat random draw/);
      expect(eventDb.updateEventSettings).not.toHaveBeenCalled();
    });

    it('refuses to change the format once teams exist', async () => {
      (eventDb.getEventBracketConfig as jest.Mock).mockResolvedValue({ ...config, status: 'bracket' });
      await expect(updateEventSettings('event-1', { team_assignment: 'manual' }))
        .rejects.toThrow('Team format can only be changed before bracket play starts');
    });
  });

  it('uses the authorized pg client for delete and update', async () => {
    const updated = createMockEvent({ id: 'event-1', location: 'New' });
    (eventDb.updateEvent as jest.Mock).mockResolvedValue(updated);
    await deleteEvent('event-1');
    await expect(updateEvent('event-1', { location: 'New' })).resolves.toBe(updated);
    expect(eventDb.deleteEvent).toHaveBeenCalledWith(pg, 'event-1');
    expect(eventDb.updateEvent).toHaveBeenCalledWith(pg, 'event-1', { location: 'New' });
  });

  it('runs qualification completion reads through the supplied admin pg', async () => {
    const players = createMockEventPlayers(2, 'event-1');
    players.forEach((player) => { player.payment_type = 'cash'; });
    const event = createMockEventWithDetails({ status: 'pre-bracket', qualification_round_enabled: true }, players);
    (eventDb.getQualificationRound as jest.Mock).mockResolvedValue({ frame_count: 5 });
    (eventDb.getQualificationFrameCounts as jest.Mock).mockResolvedValue({
      [players[0].id]: 5, [players[1].id]: 5,
    });
    await expect(validateEventStatusTransition('event-1', 'bracket', event, pg as never)).resolves.toBeUndefined();
    expect(eventDb.getQualificationRound).toHaveBeenCalledWith(pg, 'event-1');
    expect(eventDb.getQualificationFrameCounts).toHaveBeenCalledWith(pg, 'event-1');
  });

  describe('pre-bracket to bracket player count', () => {
    function paidEvent(playerCount: number, teamSize: number) {
      const players = createMockEventPlayers(playerCount, 'event-1');
      players.forEach((player) => { player.payment_type = 'cash'; });
      return createMockEventWithDetails({ status: 'pre-bracket', team_size: teamSize }, players);
    }

    it.each([
      [1, 1], [1, 5], [2, 4], [2, 8], [3, 6], [3, 9],
    ])('allows team size %i with %i players', async (teamSize, playerCount) => {
      await expect(
        validateEventStatusTransition('event-1', 'bracket', paidEvent(playerCount, teamSize), pg as never)
      ).resolves.toBeUndefined();
    });

    it.each([
      [2, 5, "5 players can't be split into teams of 2: add 1 player or remove 1 player before starting bracket play"],
      [3, 16, "16 players can't be split into teams of 3: add 2 players or remove 1 player before starting bracket play"],
      [3, 4, "4 players can't be split into teams of 3: add 2 players or remove 1 player before starting bracket play"],
    ])('blocks team size %i with %i players, naming the shortfall', async (teamSize, playerCount, message) => {
      await expect(
        validateEventStatusTransition('event-1', 'bracket', paidEvent(playerCount, teamSize), pg as never)
      ).rejects.toThrow(new BadRequestError(message));
    });
  });
});
