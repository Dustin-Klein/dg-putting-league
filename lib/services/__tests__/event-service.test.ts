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
  createMockQueryBuilder,
  createMockUser,
  createMockEvent,
  createMockEventWithDetails,
  createMockEventPlayers,
  createMockLeagueAdmin,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/services/auth', () => ({
  requireAuthenticatedUser: jest.fn(),
}));

jest.mock('@/lib/repositories/event-repository', () => ({
  getEventLeagueId: jest.fn(),
  getEventWithPlayers: jest.fn(),
  getEventsByLeagueId: jest.fn(),
  deleteEvent: jest.fn(),
  getQualificationRound: jest.fn(),
  getQualificationFrameCounts: jest.fn(),
  updateEvent: jest.fn(),
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
import { requireAuthenticatedUser } from '@/lib/services/auth';
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

  describe('requireEventAdmin', () => {
    const eventId = 'event-123';
    const leagueId = 'league-123';

    beforeEach(() => {
      const mockUser = createMockUser({ id: 'user-123' });
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(mockUser);
    });

    it('should return supabase client when user is event admin', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue(leagueId);

      const mockAdmin = createMockLeagueAdmin({ league_id: leagueId, user_id: 'user-123' });
      const queryBuilder = createMockQueryBuilder({ data: mockAdmin, error: null });
      mockSupabase.from.mockReturnValue(queryBuilder);

      const result = await requireEventAdmin(eventId);

      expect(result.supabase).toBeDefined();
      expect(eventRepo.getEventLeagueId).toHaveBeenCalledWith(mockSupabase, eventId);
    });

    it('should throw ForbiddenError when event not found', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue(null);

      await expect(requireEventAdmin(eventId)).rejects.toThrow(
        new ForbiddenError('Event not found')
      );
    });

    it('should throw ForbiddenError when user is not league admin', async () => {
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue(leagueId);

      const queryBuilder = createMockQueryBuilder({ data: null, error: null });
      mockSupabase.from.mockReturnValue(queryBuilder);

      await expect(requireEventAdmin(eventId)).rejects.toThrow(ForbiddenError);
    });

    it('should require authentication', async () => {
      (requireAuthenticatedUser as jest.Mock).mockRejectedValue(
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

      expect(redirect).toHaveBeenCalledWith('/leagues');
    });

    it('should redirect when eventId is falsy', async () => {
      await getEventWithPlayers(null as unknown as string);

      expect(redirect).toHaveBeenCalledWith('/leagues');
    });
  });

  describe('getEventsByLeagueId', () => {
    const leagueId = 'league-123';

    it('should return events for league when user is admin', async () => {
      const mockUser = createMockUser({ id: 'user-123' });
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const mockAdmin = createMockLeagueAdmin({ league_id: leagueId, user_id: 'user-123' });
      const queryBuilder = createMockQueryBuilder({ data: mockAdmin, error: null });
      mockSupabase.from.mockReturnValue(queryBuilder);

      const mockEvents = [
        createMockEvent({ id: 'event-1', league_id: leagueId }),
        createMockEvent({ id: 'event-2', league_id: leagueId }),
      ];
      (eventRepo.getEventsByLeagueId as jest.Mock).mockResolvedValue(mockEvents);

      const result = await getEventsByLeagueId(leagueId);

      expect(result).toEqual(mockEvents);
      expect(eventRepo.getEventsByLeagueId).toHaveBeenCalledWith(mockSupabase, leagueId);
    });

    it('should throw UnauthorizedError when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      await expect(getEventsByLeagueId(leagueId)).rejects.toThrow(UnauthorizedError);
    });

    it('should throw ForbiddenError when not league admin', async () => {
      const mockUser = createMockUser({ id: 'user-123' });
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const queryBuilder = createMockQueryBuilder({ data: null, error: { message: 'Not found' } });
      mockSupabase.from.mockReturnValue(queryBuilder);

      await expect(getEventsByLeagueId(leagueId)).rejects.toThrow(ForbiddenError);
      await expect(getEventsByLeagueId(leagueId)).rejects.toThrow(
        'User is not an admin of this league'
      );
    });
  });

  describe('deleteEvent', () => {
    const eventId = 'event-123';

    it('should delete event when user is admin', async () => {
      const mockUser = createMockUser({ id: 'user-123' });
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(mockUser);
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue('league-123');

      const mockAdmin = createMockLeagueAdmin();
      const queryBuilder = createMockQueryBuilder({ data: mockAdmin, error: null });
      mockSupabase.from.mockReturnValue(queryBuilder);

      (eventRepo.deleteEvent as jest.Mock).mockResolvedValue(undefined);

      await deleteEvent(eventId);

      expect(eventRepo.deleteEvent).toHaveBeenCalledWith(mockSupabase, eventId);
    });

    it('should throw ForbiddenError when not admin', async () => {
      const mockUser = createMockUser({ id: 'user-123' });
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(mockUser);
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue('league-123');

      const queryBuilder = createMockQueryBuilder({ data: null, error: null });
      mockSupabase.from.mockReturnValue(queryBuilder);

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
        players.forEach((p) => (p.has_paid = true));
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
        players[0].has_paid = false;
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
        players.forEach((p) => (p.has_paid = true));
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
      const mockUser = createMockUser({ id: 'user-123' });
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(mockUser);
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue('league-123');

      const mockAdmin = createMockLeagueAdmin();
      const queryBuilder = createMockQueryBuilder({ data: mockAdmin, error: null });
      mockSupabase.from.mockReturnValue(queryBuilder);

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
      const mockUser = createMockUser({ id: 'user-123' });
      (requireAuthenticatedUser as jest.Mock).mockResolvedValue(mockUser);
      (eventRepo.getEventLeagueId as jest.Mock).mockResolvedValue('league-123');

      const mockAdmin = createMockLeagueAdmin();
      const queryBuilder = createMockQueryBuilder({ data: mockAdmin, error: null });
      mockSupabase.from.mockReturnValue(queryBuilder);
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

    it('should rethrow non-duplicate bracket errors', async () => {
      const event = createMockEventWithDetails({ id: eventId, status: 'pre-bracket' });

      (computePoolAssignments as jest.Mock).mockResolvedValue([]);
      (computeTeamPairings as jest.Mock).mockReturnValue([]);
      mockSupabase.rpc.mockResolvedValue({ error: null });
      (createBracket as jest.Mock).mockRejectedValue(new Error('Some other error'));

      await expect(transitionEventToBracket(eventId, event)).rejects.toThrow('Some other error');
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
