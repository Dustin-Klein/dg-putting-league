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
import { Status } from 'brackets-model';

// Mock server-only before importing repository
jest.mock('server-only', () => ({}));

import {
  bracketStageExists,
  getBracketStage,
  fetchBracketStructure,
  getParticipantsWithTeamIds,
  getReadyMatchesByStageId,
} from '../bracket-repository';

describe('Bracket Repository', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
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
