/**
 * Bracket Repository Tests
 *
 * Tests for bracket data access functions including:
 * - SupabaseBracketStorage class (implements brackets-manager Storage interface)
 * - Standalone bracket match functions
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  createMockSupabaseClient,
  createMockQueryBuilder,
  MockSupabaseClient,
} from '@/lib/services/__tests__/test-utils';
import { InternalError } from '@/lib/errors';
import { Status } from 'brackets-model';

// Mock server-only before importing repository
jest.mock('server-only', () => ({}));

import {
  getMatchesForScoringByEvent,
  getMatchForScoringById,
  updateMatchStatus,
  bracketStageExists,
  getBracketStage,
  fetchBracketStructure,
  getMatchByIdAndEvent,
  getParticipantsWithTeamIds,
  getReadyMatchesByStageId,
} from '../bracket-repository';

describe('Bracket Repository', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
  });

  describe('getMatchesForScoringByEvent', () => {
    it('should return matches for scoring with frames and results', async () => {
      const mockMatches = [
        {
          id: 1,
          status: 2,
          round_id: 1,
          number: 1,
          lane_id: 'lane-1',
          opponent1: { id: 1, score: 0 },
          opponent2: { id: 2, score: 0 },
          frames: [
            {
              id: 'frame-1',
              frame_number: 1,
              is_overtime: false,
              results: [],
            },
          ],
        },
      ];

      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.in.mockReturnThis();
      mockQuery.not.mockResolvedValue({ data: mockMatches, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getMatchesForScoringByEvent(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockMatches);
      expect(mockQuery.eq).toHaveBeenCalledWith('event_id', 'event-123');
      expect(mockQuery.in).toHaveBeenCalledWith('status', [2, 3]);
    });

    it('should throw InternalError on query failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.in.mockReturnThis();
      mockQuery.not.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        getMatchesForScoringByEvent(mockSupabase as any, 'event-123')
      ).rejects.toThrow(InternalError);
    });
  });

  describe('getMatchForScoringById', () => {
    it('should return match with frames and results combined', async () => {
      const mockMatchData = {
        id: 1,
        status: 3,
        round_id: 1,
        number: 1,
        lane_id: 'lane-1',
        opponent1: { id: 1 },
        opponent2: { id: 2 },
        event_id: 'event-123',
        frames: [{ id: 'frame-1', frame_number: 1, is_overtime: false }],
      };
      const mockFrameResults = [
        { match_frame_id: 'frame-1', id: 'r1', event_player_id: 'ep1', putts_made: 2, points_earned: 2 },
      ];

      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockMatchData, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);
      mockSupabase.rpc.mockResolvedValue({ data: mockFrameResults, error: null });

      const result = await getMatchForScoringById(mockSupabase as any, 1);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(1);
      expect(result?.frames[0].results).toHaveLength(1);
    });

    it('should return null when match not found', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

      const result = await getMatchForScoringById(mockSupabase as any, 999);

      expect(result).toBeNull();
    });
  });

  describe('updateMatchStatus', () => {
    it('should update match status successfully', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await updateMatchStatus(mockSupabase as any, 1, Status.Running);

      expect(mockSupabase.from).toHaveBeenCalledWith('bracket_match');
      expect(mockQuery.update).toHaveBeenCalledWith({ status: Status.Running });
      expect(mockQuery.eq).toHaveBeenCalledWith('id', 1);
    });

    it('should throw InternalError on failure', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: { message: 'Update failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        updateMatchStatus(mockSupabase as any, 1, Status.Running)
      ).rejects.toThrow(InternalError);
    });
  });

  describe('bracketStageExists', () => {
    it('should return true when stage exists', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: { id: 1 }, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await bracketStageExists(mockSupabase as any, 'event-123');

      expect(result).toBe(true);
    });

    it('should return false when stage does not exist', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await bracketStageExists(mockSupabase as any, 'event-123');

      expect(result).toBe(false);
    });
  });

  describe('getBracketStage', () => {
    it('should return stage data', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: { id: 1 }, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getBracketStage(mockSupabase as any, 'event-123');

      expect(result).toEqual({ id: 1 });
    });
  });

  describe('fetchBracketStructure', () => {
    it('should return complete bracket structure', async () => {
      const mockStage = { id: 1, tournament_id: 'event-123' };
      const mockGroups = [{ id: 1, stage_id: 1, number: 1 }];
      const mockRounds = [{ id: 1, stage_id: 1, group_id: 1, number: 1 }];
      const mockMatches = [{ id: 1, stage_id: 1, round_id: 1, number: 1 }];
      const mockParticipants = [{ id: 1, tournament_id: 'event-123' }];

      // Stage query
      const stageQuery = createMockQueryBuilder();
      stageQuery.select.mockReturnThis();
      stageQuery.eq.mockReturnThis();
      stageQuery.maybeSingle.mockResolvedValue({ data: mockStage, error: null });

      // Groups query (single order)
      const groupsQuery = createMockQueryBuilder();
      groupsQuery.select.mockReturnThis();
      groupsQuery.eq.mockReturnThis();
      groupsQuery.order.mockResolvedValue({ data: mockGroups, error: null });

      // Rounds query (needs .order().order() chain)
      const roundsQuery = createMockQueryBuilder();
      roundsQuery.select.mockReturnThis();
      roundsQuery.eq.mockReturnThis();
      let roundsOrderCount = 0;
      roundsQuery.order.mockImplementation(() => {
        roundsOrderCount++;
        if (roundsOrderCount === 2) {
          return Promise.resolve({ data: mockRounds, error: null });
        }
        return roundsQuery;
      });

      // Matches query (needs .order().order() chain)
      const matchesQuery = createMockQueryBuilder();
      matchesQuery.select.mockReturnThis();
      matchesQuery.eq.mockReturnThis();
      let matchesOrderCount = 0;
      matchesQuery.order.mockImplementation(() => {
        matchesOrderCount++;
        if (matchesOrderCount === 2) {
          return Promise.resolve({ data: mockMatches, error: null });
        }
        return matchesQuery;
      });

      // Participants query (single order)
      const participantsQuery = createMockQueryBuilder();
      participantsQuery.select.mockReturnThis();
      participantsQuery.eq.mockReturnThis();
      participantsQuery.order.mockResolvedValue({ data: mockParticipants, error: null });

      let callCount = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++;
        if (callCount === 1) return stageQuery; // First call for stage
        if (table === 'bracket_group') return groupsQuery;
        if (table === 'bracket_round') return roundsQuery;
        if (table === 'bracket_match') return matchesQuery;
        if (table === 'bracket_participant') return participantsQuery;
        return createMockQueryBuilder();
      });

      const result = await fetchBracketStructure(mockSupabase as any, 'event-123');

      expect(result).not.toBeNull();
      expect(result?.stage).toEqual(mockStage);
      expect(result?.groups).toEqual(mockGroups);
      expect(result?.rounds).toEqual(mockRounds);
      expect(result?.matches).toEqual(mockMatches);
      expect(result?.participants).toEqual(mockParticipants);
    });

    it('should return null when no stage exists', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await fetchBracketStructure(mockSupabase as any, 'event-123');

      expect(result).toBeNull();
    });
  });

  describe('getMatchByIdAndEvent', () => {
    it('should return match when found', async () => {
      const mockMatch = {
        id: 1,
        status: 2,
        event_id: 'event-123',
        lane_id: 5,
        opponent1: { id: 1 },
        opponent2: { id: 2 },
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: mockMatch, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getMatchByIdAndEvent(mockSupabase as any, 1, 'event-123');

      expect(result).toEqual(mockMatch);
    });

    it('should return null when not found (PGRST116)', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getMatchByIdAndEvent(mockSupabase as any, 999, 'event-123');

      expect(result).toBeNull();
    });
  });

  describe('getParticipantsWithTeamIds', () => {
    it('should return participants with team IDs', async () => {
      const mockParticipants = [
        { id: 1, team_id: 'team-1' },
        { id: 2, team_id: 'team-2' },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ data: mockParticipants, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getParticipantsWithTeamIds(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockParticipants);
    });
  });

  describe('getReadyMatchesByStageId', () => {
    it('should return matches with Ready status', async () => {
      const mockMatches = [
        { id: 1, status: Status.Ready, round_id: 1, number: 1 },
        { id: 2, status: Status.Ready, round_id: 1, number: 2 },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      // Chain .order().order() - first returns this, second resolves
      let orderCount = 0;
      mockQuery.order.mockImplementation(() => {
        orderCount++;
        if (orderCount === 2) {
          return Promise.resolve({ data: mockMatches, error: null });
        }
        return mockQuery;
      });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getReadyMatchesByStageId(mockSupabase as any, 1);

      expect(result).toEqual(mockMatches);
      expect(mockQuery.eq).toHaveBeenCalledWith('status', Status.Ready);
    });
  });

});
