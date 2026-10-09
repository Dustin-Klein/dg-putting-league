/**
 * Event Service Tests
 *
 * Tests for event management functions:
 * - requireEventAdmin()
 * - getEventWithPlayers()
 * - getEventsByLeagueId()
 * - deleteEvent()
 * - validateEventStatusTransition()
 * - updateEvent()
 * - transitionEventToBracket()
 */

import {
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  InternalError,
} from '@/lib/errors';
import {
  createMockSupabaseClient,
  createMockUser,
  createMockEvent,
  createMockEventWithDetails,
  createMockEventPlayers,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/services/auth', () =>
  jest.requireActual('./test-utils').createAuthServiceMock()
);

jest.mock('@/lib/repositories/event-repository', () => ({
  getEventLeagueId: jest.fn(),
  getEventWithPlayers: jest.fn(),
  getEventsByLeagueId: jest.fn(),
  deleteEvent: jest.fn(),
  getQualificationRound: jest.fn(),
  getQualificationFrameCounts: jest.fn(),
  updateEvent: jest.fn(),
  isAccessCodeUnique: jest.fn(),
  createEvent: jest.fn(),
  getEventAccessCode: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { requireLeagueAdmin } from '@/lib/services/auth';
import * as eventRepo from '@/lib/repositories/event-repository';
import { redirect } from 'next/navigation';
import {
  requireEventAdmin,
  getEventWithPlayers,
  getEventForViewer,
  getEventsByLeagueId,
  createEvent,
  deleteEvent,
  validateEventStatusTransition,
  updateEvent,
  updateEventSettings,
} from '../event/event-service';

describe('Event Service', () => {
  let mockSupabase: MockSupabaseClient;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    // Silence console.error during tests
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('createEvent', () => {
    const leagueId = 'league-123';
    const eventData = {
      league_id: leagueId,
      event_date: '2026-01-20',
      location: 'Test Location',
      lane_count: 4,
      putt_distance_ft: 15,
      access_code: 'TEST2026',
      qualification_round_enabled: false,
      bracket_frame_count: 5,
      qualification_frame_count: 5,
    };

    it('should create event successfully when user is admin and code is unique', async () => {
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser(), isAdmin: true });
      (eventRepo.isAccessCodeUnique as jest.Mock).mockResolvedValue(true);
      (eventRepo.createEvent as jest.Mock).mockResolvedValue(createMockEvent(eventData));

      const result = await createEvent(eventData);

      expect(result).toBeDefined();
      expect(requireLeagueAdmin).toHaveBeenCalledWith(leagueId);
      expect(eventRepo.isAccessCodeUnique).toHaveBeenCalledWith(mockSupabase, 'test2026');
      expect(eventRepo.createEvent).toHaveBeenCalledWith(mockSupabase, {
        ...eventData,
        access_code: 'test2026',
        entry_fee_per_player: null,
        admin_fees: null,
        admin_fee_per_player: null,
        status: 'created',
      });
    });

    it('should throw BadRequestError when access code already exists', async () => {
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser(), isAdmin: true });
      (eventRepo.isAccessCodeUnique as jest.Mock).mockResolvedValue(false);

      await expect(createEvent(eventData)).rejects.toThrow(BadRequestError);
      await expect(createEvent(eventData)).rejects.toThrow('An event with this access code already exists');
    });

    it('should throw ForbiddenError when user is not league admin', async () => {
      (requireLeagueAdmin as jest.Mock).mockRejectedValue(new ForbiddenError('Insufficient permissions'));

      await expect(createEvent(eventData)).rejects.toThrow(ForbiddenError);
    });

    it('should pass through YYYY-MM-DD date string as-is', async () => {
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser(), isAdmin: true });
      (eventRepo.isAccessCodeUnique as jest.Mock).mockResolvedValue(true);
      (eventRepo.createEvent as jest.Mock).mockResolvedValue(createMockEvent(eventData));

      await createEvent({
        ...eventData,
        event_date: '2026-01-20',
      });

      expect(eventRepo.createEvent).toHaveBeenCalledWith(mockSupabase, expect.objectContaining({
        event_date: '2026-01-20',
      }));
    });

    it.each([
      ['2026-01-01', 'New Year / year boundary'],
      ['2025-12-31', 'Dec 31 / year boundary'],
      ['2026-02-28', 'end of February'],
      ['2026-03-01', 'start of March'],
    ])('should preserve boundary date %s (%s) through to repository', async (date) => {
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser(), isAdmin: true });
      (eventRepo.isAccessCodeUnique as jest.Mock).mockResolvedValue(true);
      (eventRepo.createEvent as jest.Mock).mockResolvedValue(createMockEvent({ ...eventData, event_date: date }));

      await createEvent({ ...eventData, event_date: date });

      expect(eventRepo.createEvent).toHaveBeenCalledWith(mockSupabase, expect.objectContaining({
        event_date: date,
      }));
    });
  });

  describe('requireEventAdmin', () => {
    const eventId = 'event-123';
    const leagueId = 'league-123';

    it('should return supabase client when user is event admin', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue(leagueId);
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser({ id: 'user-123' }), isAdmin: true });

      const result = await requireEventAdmin(eventId);

      expect(result.supabase).toBeDefined();
      expect(result.user).toEqual(createMockUser({ id: 'user-123' }));
      expect(eventRepo.getEventLeagueId).toHaveBeenCalledWith(mockSupabase, eventId);
      expect(requireLeagueAdmin).toHaveBeenCalledWith(leagueId);
    });

    it('should throw ForbiddenError when event not found', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue(null);

      await expect(requireEventAdmin(eventId)).rejects.toThrow(
        new ForbiddenError('Event not found')
      );
    });

    it('should throw ForbiddenError when user is not league admin', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue(leagueId);
      (requireLeagueAdmin as jest.Mock).mockRejectedValue(new ForbiddenError('Insufficient permissions'));

      await expect(requireEventAdmin(eventId)).rejects.toThrow(ForbiddenError);
    });

    it('should require authentication', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue(leagueId);
      (requireLeagueAdmin as jest.Mock).mockRejectedValue(
        new UnauthorizedError('Not authenticated')
      );

      await expect(requireEventAdmin(eventId)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('getEventWithPlayers', () => {
    it('should return event with players', async () => {
      const players = createMockEventPlayers(4, 'event-123');
      const mockEvent = createMockEventWithDetails({ id: 'event-123' }, players);
      (eventRepo.getEventWithPlayers as jest.Mock).mockResolvedValue(mockEvent);

      const result = await getEventWithPlayers('event-123');

      expect(result).toEqual(mockEvent);
      expect(eventRepo.getEventWithPlayers).toHaveBeenCalledWith(mockSupabase, 'event-123');
    });

    it('should redirect when eventId is empty', async () => {
      await getEventWithPlayers('');

      expect(redirect).toHaveBeenCalledWith('/admin/leagues');
    });

    it('should redirect when eventId is falsy', async () => {
      await getEventWithPlayers(null as unknown as string);

      expect(redirect).toHaveBeenCalledWith('/admin/leagues');
    });
  });

  describe('getEventsByLeagueId', () => {
    const leagueId = 'league-123';

    it('should return events for league when user is admin', async () => {
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser({ id: 'user-123' }), isAdmin: true });

      const mockEvents = [
        createMockEvent({ id: 'event-1', league_id: leagueId }),
        createMockEvent({ id: 'event-2', league_id: leagueId }),
      ];
      (eventRepo.getEventsByLeagueId as jest.Mock).mockResolvedValue(mockEvents);

      const result = await getEventsByLeagueId(leagueId);

      expect(result).toEqual(mockEvents);
      expect(requireLeagueAdmin).toHaveBeenCalledWith(leagueId);
      expect(eventRepo.getEventsByLeagueId).toHaveBeenCalledWith(mockSupabase, leagueId);
    });

    it('should throw UnauthorizedError when not authenticated', async () => {
      (requireLeagueAdmin as jest.Mock).mockRejectedValue(new UnauthorizedError('Authentication required'));

      await expect(getEventsByLeagueId(leagueId)).rejects.toThrow(UnauthorizedError);
    });

    it('should throw ForbiddenError when not league admin', async () => {
      (requireLeagueAdmin as jest.Mock).mockRejectedValue(new ForbiddenError('Insufficient permissions'));

      await expect(getEventsByLeagueId(leagueId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('createEvent access code rules', () => {
    const baseData = {
      league_id: 'league-123',
      event_date: '2026-01-20',
      location: null,
      lane_count: 4,
      putt_distance_ft: 15,
      access_code: 'TEST2026',
      qualification_round_enabled: false,
      bracket_frame_count: 5,
      qualification_frame_count: 5,
    };

    beforeEach(() => {
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser(), isAdmin: true });
      (eventRepo.isAccessCodeUnique as jest.Mock).mockResolvedValue(true);
      (eventRepo.createEvent as jest.Mock).mockResolvedValue(createMockEvent());
    });

    it('stores the code trimmed and lower-cased', async () => {
      await createEvent({ ...baseData, access_code: '  MiXeD9  ' });

      expect(eventRepo.isAccessCodeUnique).toHaveBeenCalledWith(mockSupabase, 'mixed9');
      expect(eventRepo.createEvent).toHaveBeenCalledWith(
        mockSupabase,
        expect.objectContaining({ access_code: 'mixed9' })
      );
    });

    it('rejects codes shorter than 6 characters after trimming', async () => {
      await expect(createEvent({ ...baseData, access_code: ' abcde ' })).rejects.toThrow(BadRequestError);
      expect(eventRepo.createEvent).not.toHaveBeenCalled();
    });
  });

  describe('getEventForViewer', () => {
    const eventId = 'event-123';

    beforeEach(() => {
      (eventRepo.getEventWithPlayers as jest.Mock).mockResolvedValue(
        createMockEventWithDetails({ id: eventId })
      );
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue('league-123');
      (eventRepo.getEventAccessCode as jest.Mock).mockResolvedValue('abc123');
    });

    it('includes the access code for a league admin', async () => {
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser(), isAdmin: true });

      const result = await getEventForViewer(eventId);

      expect(result.access_code).toBe('abc123');
    });

    it('returns null access code for a non-admin', async () => {
      (requireLeagueAdmin as jest.Mock).mockRejectedValue(new ForbiddenError('Insufficient permissions'));

      const result = await getEventForViewer(eventId);

      expect(result.access_code).toBeNull();
      expect(eventRepo.getEventAccessCode).not.toHaveBeenCalled();
    });

    it('returns null access code when signed out', async () => {
      (requireLeagueAdmin as jest.Mock).mockRejectedValue(new UnauthorizedError('Authentication required'));

      const result = await getEventForViewer(eventId);

      expect(result.access_code).toBeNull();
    });

    it('propagates unexpected errors', async () => {
      (requireLeagueAdmin as jest.Mock).mockRejectedValue(new InternalError('db down'));

      await expect(getEventForViewer(eventId)).rejects.toThrow(InternalError);
    });
  });

  describe('deleteEvent', () => {
    const eventId = 'event-123';

    it('should delete event when user is a non-owner league admin', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue('league-123');
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({
        user: createMockUser({ id: 'user-123' }),
        isAdmin: true,
      });

      (eventRepo.deleteEvent as jest.Mock).mockResolvedValue(undefined);

      await deleteEvent(eventId);

      expect(requireLeagueAdmin).toHaveBeenCalledWith('league-123');
      expect(eventRepo.deleteEvent).toHaveBeenCalledWith(mockSupabase, eventId);
    });

    it('should throw ForbiddenError when not admin', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue('league-123');
      (requireLeagueAdmin as jest.Mock).mockRejectedValue(new ForbiddenError('Insufficient permissions'));

      await expect(deleteEvent(eventId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe('validateEventStatusTransition', () => {
    const eventId = 'event-123';

    describe('status flow validation', () => {
      it('should allow created -> pre-bracket transition', async () => {
        const event = createMockEventWithDetails({ status: 'created' });

        await expect(
          validateEventStatusTransition(eventId, 'pre-bracket', event)
        ).resolves.not.toThrow();
      });

      it('should allow pre-bracket -> bracket transition when valid', async () => {
        const players = createMockEventPlayers(4);
        players.forEach((p) => (p.payment_type = 'cash'));
        const event = createMockEventWithDetails(
          { status: 'pre-bracket', qualification_round_enabled: false },
          players
        );

        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).resolves.not.toThrow();
      });

      it('should allow bracket -> completed transition', async () => {
        const event = createMockEventWithDetails({ status: 'bracket' });

        await expect(
          validateEventStatusTransition(eventId, 'completed', event)
        ).resolves.not.toThrow();
      });

      it('should throw BadRequestError for invalid transition created -> bracket', async () => {
        const event = createMockEventWithDetails({ status: 'created' });

        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow(BadRequestError);
        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow('Invalid status transition from created to bracket');
      });

      it('should throw BadRequestError for invalid transition completed -> anything', async () => {
        const event = createMockEventWithDetails({ status: 'completed' });

        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow(BadRequestError);
      });

      it('should throw BadRequestError for backward transition', async () => {
        const event = createMockEventWithDetails({ status: 'bracket' });

        await expect(
          validateEventStatusTransition(eventId, 'pre-bracket', event)
        ).rejects.toThrow(BadRequestError);
      });
    });

    describe('pre-bracket to bracket validation (without qualification)', () => {
      it('should throw BadRequestError when player count is odd', async () => {
        const players = createMockEventPlayers(5);
        players.forEach((p) => (p.payment_type = 'cash'));
        const event = createMockEventWithDetails(
          { status: 'pre-bracket', qualification_round_enabled: false },
          players
        );

        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow(BadRequestError);
        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow('An even number of players is required');
      });

      it('should throw BadRequestError when players have not paid', async () => {
        const players = createMockEventPlayers(4);
        players[0].payment_type = null;
        const event = createMockEventWithDetails(
          { status: 'pre-bracket', qualification_round_enabled: false },
          players
        );

        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow(BadRequestError);
        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow('All players must be marked as paid');
      });

      it('should pass when all players have paid', async () => {
        const players = createMockEventPlayers(4);
        players.forEach((p) => (p.payment_type = 'cash'));
        const event = createMockEventWithDetails(
          { status: 'pre-bracket', qualification_round_enabled: false },
          players
        );

        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).resolves.not.toThrow();
      });
    });

    describe('pre-bracket to bracket validation (with qualification)', () => {
      it('should throw BadRequestError when no qualification round exists', async () => {
        const players = createMockEventPlayers(4);
        const event = createMockEventWithDetails(
          { status: 'pre-bracket', qualification_round_enabled: true },
          players
        );

        (eventRepo.getQualificationRound as jest.Mock).mockResolvedValue(null);

        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow(BadRequestError);
        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow('No qualification round found');
      });

      it('should throw BadRequestError when players have not completed qualification', async () => {
        const players = createMockEventPlayers(4);
        const event = createMockEventWithDetails(
          { status: 'pre-bracket', qualification_round_enabled: true },
          players
        );

        (eventRepo.getQualificationRound as jest.Mock).mockResolvedValue({
          id: 'qual-123',
          frame_count: 10,
        });

        // Player 1 has 10 frames, others have fewer
        const frameCounts: Record<string, number> = {
          [players[0].id]: 10,
          [players[1].id]: 8,
          [players[2].id]: 5,
          [players[3].id]: 10,
        };
        (eventRepo.getQualificationFrameCounts as jest.Mock).mockResolvedValue(frameCounts);

        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow(BadRequestError);
        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow('All players must complete 10 qualifying frames');
      });

      it('should throw BadRequestError when players have not paid even if qualification is complete', async () => {
        const players = createMockEventPlayers(4);
        players[1].payment_type = null;
        const event = createMockEventWithDetails(
          { status: 'pre-bracket', qualification_round_enabled: true },
          players
        );

        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow(BadRequestError);
        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).rejects.toThrow('All players must be marked as paid');
      });

      it('should pass when all players have completed qualification', async () => {
        const players = createMockEventPlayers(4);
        const event = createMockEventWithDetails(
          { status: 'pre-bracket', qualification_round_enabled: true },
          players
        );

        (eventRepo.getQualificationRound as jest.Mock).mockResolvedValue({
          id: 'qual-123',
          frame_count: 10,
        });

        const frameCounts: Record<string, number> = {
          [players[0].id]: 10,
          [players[1].id]: 10,
          [players[2].id]: 12, // More than required is OK
          [players[3].id]: 10,
        };
        (eventRepo.getQualificationFrameCounts as jest.Mock).mockResolvedValue(frameCounts);

        await expect(
          validateEventStatusTransition(eventId, 'bracket', event)
        ).resolves.not.toThrow();
      });
    });
  });

  describe('updateEvent', () => {
    const eventId = 'event-123';

    it('should update event when user is admin', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue('league-123');
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser({ id: 'user-123' }), isAdmin: true });

      const updateData = { location: 'New Location', lane_count: 6 };
      const updatedEvent = createMockEvent({ ...updateData });
      (eventRepo.updateEvent as jest.Mock).mockResolvedValue(updatedEvent);

      const result = await updateEvent(eventId, updateData);

      expect(result).toEqual(updatedEvent);
      expect(eventRepo.updateEvent).toHaveBeenCalledWith(mockSupabase, eventId, updateData);
    });
  });

  describe('updateEventSettings', () => {
    it('does not read event details or write when authorization fails', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue('league-123');
      (requireLeagueAdmin as jest.Mock).mockRejectedValue(new ForbiddenError('Insufficient permissions'));

      await expect(updateEventSettings('event-123', { status: 'completed', force: true }))
        .rejects.toThrow(ForbiddenError);
      expect(eventRepo.getEventWithPlayers).not.toHaveBeenCalled();
      expect(eventRepo.updateEvent).not.toHaveBeenCalled();
    });
  });


});
