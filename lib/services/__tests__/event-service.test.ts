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

jest.mock('@/lib/services/auth', () => ({
  requireAuthenticatedUser: jest.fn(),
  requireLeagueAdmin: jest.fn(),
}));

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
}));

jest.mock('@/lib/services/event-player', () => ({
  computePoolAssignments: jest.fn(),
}));

jest.mock('@/lib/services/team', () => ({
  computeTeamPairings: jest.fn(),
}));

jest.mock('@/lib/services/bracket', () => ({
  createBracket: jest.fn(),
}));

jest.mock('@/lib/services/lane', () => ({
  autoAssignLanes: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { requireLeagueAdmin } from '@/lib/services/auth';
import * as eventRepo from '@/lib/repositories/event-repository';
import { computePoolAssignments } from '@/lib/services/event-player';
import { computeTeamPairings } from '@/lib/services/team';
import { createBracket } from '@/lib/services/bracket';
import { autoAssignLanes } from '@/lib/services/lane';
import { redirect } from 'next/navigation';
import {
  requireEventAdmin,
  getEventWithPlayers,
  getEventsByLeagueId,
  createEvent,
  deleteEvent,
  validateEventStatusTransition,
  updateEvent,
  transitionEventToBracket,
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
      expect(eventRepo.isAccessCodeUnique).toHaveBeenCalledWith(mockSupabase, eventData.access_code);
      expect(eventRepo.createEvent).toHaveBeenCalledWith(mockSupabase, {
        ...eventData,
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

    it('should format date correctly', async () => {
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser(), isAdmin: true });
      (eventRepo.isAccessCodeUnique as jest.Mock).mockResolvedValue(true);
      (eventRepo.createEvent as jest.Mock).mockResolvedValue(createMockEvent(eventData));

      await createEvent({
        ...eventData,
        event_date: '2026-01-20T12:00:00.000Z',
      });

      expect(eventRepo.createEvent).toHaveBeenCalledWith(mockSupabase, expect.objectContaining({
        event_date: '2026-01-20',
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

  describe('deleteEvent', () => {
    const eventId = 'event-123';

    it('should delete event when user is admin', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue('league-123');
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser({ id: 'user-123' }), isAdmin: true });

      (eventRepo.deleteEvent as jest.Mock).mockResolvedValue(undefined);

      await deleteEvent(eventId);

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

  describe('transitionEventToBracket', () => {
    const eventId = 'event-123';

    beforeEach(() => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue('league-123');
      (requireLeagueAdmin as jest.Mock).mockResolvedValue({ user: createMockUser({ id: 'user-123' }), isAdmin: true });
    });

    it('should transition event to bracket successfully', async () => {
      const players = createMockEventPlayers(4);
      const event = createMockEventWithDetails(
        { id: eventId, status: 'pre-bracket', lane_count: 4 },
        players
      );

      const poolAssignments = players.map((p, i) => ({
        eventPlayerId: p.id,
        playerId: p.player_id,
        playerName: p.player.full_name,
        pool: i < 2 ? 'A' : 'B',
        pfaScore: 10 - i,
        scoringMethod: 'default',
      }));

      const teamPairings = [
        {
          seed: 1,
          poolCombo: 'Player 1 & Player 3',
          combinedScore: 17,
          members: [
            { eventPlayerId: players[0].id, role: 'A_pool' },
            { eventPlayerId: players[2].id, role: 'B_pool' },
          ],
        },
        {
          seed: 2,
          poolCombo: 'Player 2 & Player 4',
          combinedScore: 13,
          members: [
            { eventPlayerId: players[1].id, role: 'A_pool' },
            { eventPlayerId: players[3].id, role: 'B_pool' },
          ],
        },
      ];

      (computePoolAssignments as jest.Mock).mockResolvedValue(poolAssignments);
      (computeTeamPairings as jest.Mock).mockReturnValue(teamPairings);
      mockSupabase.rpc.mockResolvedValue({ error: null });
      (createBracket as jest.Mock).mockResolvedValue({});
      (autoAssignLanes as jest.Mock).mockResolvedValue(2);

      await transitionEventToBracket(eventId, event);

      expect(computePoolAssignments).toHaveBeenCalledWith(eventId, event);
      expect(computeTeamPairings).toHaveBeenCalledWith(poolAssignments);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('transition_event_to_bracket', {
        p_event_id: eventId,
        p_pool_assignments: expect.any(Array),
        p_teams: expect.any(Array),
        p_lane_count: 4,
      });
      expect(createBracket).toHaveBeenCalledWith(eventId, true);
      expect(autoAssignLanes).toHaveBeenCalledWith(eventId);
    });

    it('should throw InternalError when RPC fails', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' });

      (computePoolAssignments as jest.Mock).mockResolvedValue([]);
      (computeTeamPairings as jest.Mock).mockReturnValue([]);
      mockSupabase.rpc.mockResolvedValue({
        error: { message: 'RPC failed' },
      });

      await expect(transitionEventToBracket(eventId, event)).rejects.toThrow(InternalError);
      await expect(transitionEventToBracket(eventId, event)).rejects.toThrow(
        'Failed to transition event to bracket'
      );
    });

    it('should handle bracket already created gracefully', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' });

      (computePoolAssignments as jest.Mock).mockResolvedValue([]);
      (computeTeamPairings as jest.Mock).mockReturnValue([]);
      mockSupabase.rpc.mockResolvedValue({ error: null });
      (createBracket as jest.Mock).mockRejectedValue(
        new BadRequestError('Bracket has already been created')
      );

      // Should not throw
      await expect(transitionEventToBracket(eventId, event)).resolves.not.toThrow();
    });

    it('should rollback transition when bracket creation fails with non-duplicate error', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' });

      (computePoolAssignments as jest.Mock).mockResolvedValue([]);
      (computeTeamPairings as jest.Mock).mockReturnValue([]);
      mockSupabase.rpc
        .mockResolvedValueOnce({ error: null }) // transition RPC succeeds
        .mockResolvedValueOnce({ error: null }); // rollback RPC succeeds
      (createBracket as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

      await expect(transitionEventToBracket(eventId, event)).rejects.toThrow(
        'Failed to create bracket. Transaction rolled back'
      );
      expect(mockSupabase.rpc).toHaveBeenCalledWith('rollback_bracket_transition', {
        p_event_id: eventId,
      });
    });

    it('should throw with manual intervention message when both bracket and rollback fail', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' });

      (computePoolAssignments as jest.Mock).mockResolvedValue([]);
      (computeTeamPairings as jest.Mock).mockReturnValue([]);
      mockSupabase.rpc
        .mockResolvedValueOnce({ error: null }) // transition succeeds
        .mockResolvedValueOnce({ error: { message: 'Rollback failed' } }); // rollback fails
      (createBracket as jest.Mock).mockRejectedValue(new Error('Bracket error'));

      await expect(transitionEventToBracket(eventId, event)).rejects.toThrow(
        'Manual intervention required'
      );
    });

    it('should skip lane assignment when lane_count is 0', async () => {
      const event = createMockEventWithDetails(
        { id: eventId, status: 'pre-bracket', lane_count: 0 },
        []
      );

      (computePoolAssignments as jest.Mock).mockResolvedValue([]);
      (computeTeamPairings as jest.Mock).mockReturnValue([]);
      mockSupabase.rpc.mockResolvedValue({ error: null });
      (createBracket as jest.Mock).mockResolvedValue({});

      await transitionEventToBracket(eventId, event);

      expect(autoAssignLanes).not.toHaveBeenCalled();
    });

    it('should handle lane assignment errors gracefully', async () => {
      const event = createMockEventWithDetails(
        { id: eventId, status: 'pre-bracket', lane_count: 4 },
        []
      );

      (computePoolAssignments as jest.Mock).mockResolvedValue([]);
      (computeTeamPairings as jest.Mock).mockReturnValue([]);
      mockSupabase.rpc.mockResolvedValue({ error: null });
      (createBracket as jest.Mock).mockResolvedValue({});
      (autoAssignLanes as jest.Mock).mockRejectedValue(new Error('Lane assignment failed'));

      // Should not throw - lane errors are logged but not propagated
      await expect(transitionEventToBracket(eventId, event)).resolves.not.toThrow();
    });
  });
});
