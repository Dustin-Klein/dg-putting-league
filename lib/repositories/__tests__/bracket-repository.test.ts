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
import { InternalError, BadRequestError } from '@/lib/errors';
import { Status } from 'brackets-model';

// Mock server-only before importing repository
jest.mock('server-only', () => ({}));

import {
  SupabaseBracketStorage,
  getMatchesForScoringByEvent,
  getMatchForScoringById,
  updateMatchStatus,
  bulkUpdateMatchStatuses,
  bracketStageExists,
  getBracketStage,
  linkParticipantsToTeams,
  getBracketParticipants,
  setEventIdOnMatches,
  getMatchesByStageId,
  getMatchWithGroupInfo,
  getSecondGrandFinalMatch,
  archiveMatch,
  fetchBracketStructure,
  getMatchByIdAndEvent,
  getMatchWithOpponents,
  updateMatchOpponentScores,
  getParticipantsWithTeamIds,
  getMatchWithStage,
  getReadyMatchesByStageId,
  assignLaneToMatchRpc,
} from '../bracket-repository';

describe('Bracket Repository', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
  });

  // ============================================================================
  // SupabaseBracketStorage Class Tests
  // ============================================================================

  describe('SupabaseBracketStorage', () => {
    const eventId = 'event-123';
    let storage: SupabaseBracketStorage;

    beforeEach(() => {
      storage = new SupabaseBracketStorage(mockSupabase as any, eventId);
    });

    describe('insert', () => {
      it('should insert a single value and return its ID', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.select.mockReturnThis();
        mockQuery.single.mockResolvedValue({ data: { id: 42 }, error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.insert('stage', {
          tournament_id: eventId,
          name: 'Test Stage',
          type: 'double_elimination',
          number: 1,
          settings: {},
        } as any);

        expect(result).toBe(42);
        expect(mockSupabase.from).toHaveBeenCalledWith('bracket_stage');
        expect(mockQuery.insert).toHaveBeenCalled();
      });

      it('should insert multiple values and return true on success', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.insert.mockResolvedValue({ error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.insert('match', [
          { stage_id: 1, group_id: 1, round_id: 1, number: 1, status: Status.Waiting },
          { stage_id: 1, group_id: 1, round_id: 1, number: 2, status: Status.Waiting },
        ] as any);

        expect(result).toBe(true);
        expect(mockSupabase.from).toHaveBeenCalledWith('bracket_match');
      });

      it('should return false when bulk insert fails', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.insert.mockResolvedValue({ error: { message: 'Insert failed' } });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.insert('match', [
          { stage_id: 1, group_id: 1, round_id: 1, number: 1, status: Status.Waiting },
        ] as any);

        expect(result).toBe(false);
      });

      it('should throw error when single insert fails', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.select.mockReturnThis();
        mockQuery.single.mockResolvedValue({ data: null, error: { message: 'Insert failed' } });
        mockSupabase.from.mockReturnValue(mockQuery);

        await expect(
          storage.insert('participant', { tournament_id: eventId, name: 'Team 1' } as any)
        ).rejects.toThrow('Failed to insert into bracket_participant');
      });
    });

    describe('select', () => {
      it('should select all records from a table', async () => {
        const mockData = [
          { id: 1, tournament_id: eventId, name: 'Stage 1' },
          { id: 2, tournament_id: eventId, name: 'Stage 2' },
        ];
        const mockQuery = createMockQueryBuilder();
        mockQuery.select.mockReturnThis();
        mockQuery.eq.mockResolvedValue({ data: mockData, error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.select('stage');

        expect(result).toHaveLength(2);
        expect(mockSupabase.from).toHaveBeenCalledWith('bracket_stage');
        expect(mockQuery.eq).toHaveBeenCalledWith('tournament_id', eventId);
      });

      it('should select a single record by ID', async () => {
        const mockData = { id: 1, stage_id: 1, number: 1 };
        const mockQuery = createMockQueryBuilder();
        mockQuery.select.mockReturnThis();
        mockQuery.eq.mockReturnThis();
        mockQuery.single.mockResolvedValue({ data: mockData, error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.select('group', 1);

        expect(result).toEqual(mockData);
        expect(mockQuery.eq).toHaveBeenCalledWith('id', 1);
      });

      it('should select records by filter', async () => {
        const mockData = [{ id: 1, stage_id: 1, group_id: 1 }];
        const mockQuery = createMockQueryBuilder();
        mockQuery.select.mockReturnThis();
        mockQuery.eq.mockResolvedValue({ data: mockData, error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.select('round', { stage_id: 1 } as any);

        expect(result).toEqual(mockData);
        expect(mockQuery.eq).toHaveBeenCalledWith('stage_id', 1);
      });

      it('should return null on error', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.select.mockReturnThis();
        mockQuery.eq.mockResolvedValue({ data: null, error: { message: 'Query failed' } });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.select('stage');

        expect(result).toBeNull();
      });

      it('should return null when selecting non-existent record by ID', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.select.mockReturnThis();
        mockQuery.eq.mockReturnThis();
        mockQuery.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.select('match', 999);

        expect(result).toBeNull();
      });
    });

    describe('update', () => {
      it('should update a record by ID', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.update.mockReturnThis();
        mockQuery.eq.mockResolvedValue({ error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.update('group', 1, { number: 2 } as any);

        expect(result).toBe(true);
        expect(mockSupabase.from).toHaveBeenCalledWith('bracket_group');
        expect(mockQuery.eq).toHaveBeenCalledWith('id', 1);
      });

      it('should use RPC for match updates by ID', async () => {
        mockSupabase.rpc.mockResolvedValue({ error: null });

        const result = await storage.update('match', 1, {
          status: Status.Completed,
          opponent1: { id: 1, score: 3 },
          opponent2: { id: 2, score: 2 },
        } as any);

        expect(result).toBe(true);
        expect(mockSupabase.rpc).toHaveBeenCalledWith('update_bracket_match_score', {
          p_match_id: 1,
          p_status: Status.Completed,
          p_opponent1: { id: 1, score: 3 },
          p_opponent2: { id: 2, score: 2 },
        });
      });

      it('should update records by filter', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.update.mockReturnThis();
        mockQuery.eq.mockResolvedValue({ error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.update(
          'round',
          { stage_id: 1 } as any,
          { number: 5 } as any
        );

        expect(result).toBe(true);
        expect(mockQuery.eq).toHaveBeenCalledWith('stage_id', 1);
      });

      it('should return false on update error', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.update.mockReturnThis();
        mockQuery.eq.mockResolvedValue({ error: { message: 'Update failed' } });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.update('group', 1, { number: 2 } as any);

        expect(result).toBe(false);
      });
    });

    describe('delete', () => {
      it('should delete all records for event', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.delete.mockReturnThis();
        mockQuery.eq.mockResolvedValue({ error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.delete('participant');

        expect(result).toBe(true);
        expect(mockQuery.eq).toHaveBeenCalledWith('tournament_id', eventId);
      });

      it('should delete records by filter', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.delete.mockReturnThis();
        mockQuery.eq.mockResolvedValue({ error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.delete('match', { round_id: 1 } as any);

        expect(result).toBe(true);
        expect(mockQuery.eq).toHaveBeenCalledWith('round_id', 1);
      });

      it('should return false on delete error', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.delete.mockReturnThis();
        mockQuery.eq.mockResolvedValue({ error: { message: 'Delete failed' } });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.delete('stage');

        expect(result).toBe(false);
      });
    });

    describe('selectFirst', () => {
      it('should select the first matching record', async () => {
        const mockData = [{ id: 1, round_id: 1, number: 1 }];
        const mockQuery = createMockQueryBuilder();
        mockQuery.select.mockReturnThis();
        mockQuery.eq.mockReturnThis();
        mockQuery.order.mockReturnThis();
        mockQuery.limit.mockResolvedValue({ data: mockData, error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.selectFirst('match', { round_id: 1 } as any);

        expect(result).toEqual(mockData[0]);
        expect(mockQuery.order).toHaveBeenCalledWith('id', { ascending: true });
        expect(mockQuery.limit).toHaveBeenCalledWith(1);
      });

      it('should return null when no records match', async () => {
        const mockQuery = createMockQueryBuilder();
        mockQuery.select.mockReturnThis();
        mockQuery.eq.mockReturnThis();
        mockQuery.order.mockReturnThis();
        mockQuery.limit.mockResolvedValue({ data: [], error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.selectFirst('match', { round_id: 999 } as any);

        expect(result).toBeNull();
      });
    });

    describe('selectLast', () => {
      it('should select the last matching record', async () => {
        const mockData = [{ id: 5, round_id: 1, number: 5 }];
        const mockQuery = createMockQueryBuilder();
        mockQuery.select.mockReturnThis();
        mockQuery.eq.mockReturnThis();
        mockQuery.order.mockReturnThis();
        mockQuery.limit.mockResolvedValue({ data: mockData, error: null });
        mockSupabase.from.mockReturnValue(mockQuery);

        const result = await storage.selectLast('match', { round_id: 1 } as any);

        expect(result).toEqual(mockData[0]);
        expect(mockQuery.order).toHaveBeenCalledWith('id', { ascending: false });
      });
    });
  });

  // ============================================================================
  // Standalone Function Tests
  // ============================================================================

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

  describe('bulkUpdateMatchStatuses', () => {
    it('should update multiple match statuses', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.in.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await bulkUpdateMatchStatuses(mockSupabase as any, [1, 2, 3], Status.Ready);

      expect(mockQuery.in).toHaveBeenCalledWith('id', [1, 2, 3]);
    });

    it('should do nothing for empty array', async () => {
      await bulkUpdateMatchStatuses(mockSupabase as any, [], Status.Ready);

      expect(mockSupabase.from).not.toHaveBeenCalled();
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

  describe('linkParticipantsToTeams', () => {
    it('should link participants to teams in parallel', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await linkParticipantsToTeams(mockSupabase as any, [
        { participantId: 1, teamId: 'team-1' },
        { participantId: 2, teamId: 'team-2' },
      ]);

      expect(mockSupabase.from).toHaveBeenCalledWith('bracket_participant');
      expect(mockQuery.update).toHaveBeenCalledTimes(2);
    });

    it('should throw InternalError when link fails', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: { message: 'Link failed' } });
      mockSupabase.from.mockReturnValue(mockQuery);

      await expect(
        linkParticipantsToTeams(mockSupabase as any, [{ participantId: 1, teamId: 'team-1' }])
      ).rejects.toThrow(InternalError);
    });
  });

  describe('getBracketParticipants', () => {
    it('should return participants for an event', async () => {
      const mockParticipants = [
        { id: 1, tournament_id: 'event-123', name: 'Team 1', team_id: 't1' },
        { id: 2, tournament_id: 'event-123', name: 'Team 2', team_id: 't2' },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: mockParticipants, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getBracketParticipants(mockSupabase as any, 'event-123');

      expect(result).toEqual(mockParticipants);
    });
  });

  describe('setEventIdOnMatches', () => {
    it('should update event_id on all matches for a stage', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await setEventIdOnMatches(mockSupabase as any, 1, 'event-123');

      expect(mockQuery.update).toHaveBeenCalledWith({ event_id: 'event-123' });
      expect(mockQuery.eq).toHaveBeenCalledWith('stage_id', 1);
    });
  });

  describe('getMatchesByStageId', () => {
    it('should return matches with non-null opponents', async () => {
      const mockMatches = [
        { id: 1, opponent1: { id: 1 }, opponent2: { id: 2 }, status: 2 },
      ];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.not.mockReturnThis();
      // Make the query builder thenable to resolve at chain end
      (mockQuery as any).then = (resolve: (value: unknown) => void) =>
        resolve({ data: mockMatches, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getMatchesByStageId(mockSupabase as any, 1);

      expect(result).toEqual(mockMatches);
    });
  });

  describe('getMatchWithGroupInfo', () => {
    it('should return match with round and group data', async () => {
      const mockMatch = {
        id: 1,
        group_id: 1,
        round_id: 1,
        status: 2,
        opponent1: { id: 1 },
        opponent2: { id: 2 },
        round: { number: 1, group: { number: 1 } },
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockMatch, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getMatchWithGroupInfo(mockSupabase as any, 1);

      expect(result).toEqual(mockMatch);
    });
  });

  describe('getSecondGrandFinalMatch', () => {
    it('should return the reset match from second GF round', async () => {
      const mockRounds = [
        { id: 10, number: 1 },
        { id: 11, number: 2 },
      ];
      const mockMatch = { id: 100, status: 2 };

      const roundsQuery = createMockQueryBuilder();
      roundsQuery.select.mockReturnThis();
      roundsQuery.eq.mockReturnThis();
      roundsQuery.order.mockResolvedValue({ data: mockRounds, error: null });

      const matchQuery = createMockQueryBuilder();
      matchQuery.select.mockReturnThis();
      matchQuery.eq.mockReturnThis();
      matchQuery.maybeSingle.mockResolvedValue({ data: mockMatch, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'bracket_round') return roundsQuery;
        if (table === 'bracket_match') return matchQuery;
        return createMockQueryBuilder();
      });

      const result = await getSecondGrandFinalMatch(mockSupabase as any, 3);

      expect(result).toEqual(mockMatch);
    });

    it('should return null when less than 2 rounds exist', async () => {
      const mockRounds = [{ id: 10, number: 1 }];
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.order.mockResolvedValue({ data: mockRounds, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getSecondGrandFinalMatch(mockSupabase as any, 3);

      expect(result).toBeNull();
    });
  });

  describe('archiveMatch', () => {
    it('should set match status to Archived (5)', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await archiveMatch(mockSupabase as any, 1);

      expect(mockQuery.update).toHaveBeenCalledWith({ status: 5 });
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

  describe('getMatchWithOpponents', () => {
    it('should return match with opponent data', async () => {
      const mockMatch = {
        id: 1,
        status: 4,
        opponent1: { id: 1, position: 1, score: 3 },
        opponent2: { id: 2, position: 2, score: 2 },
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: mockMatch, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getMatchWithOpponents(mockSupabase as any, 1, 'event-123');

      expect(result).toEqual(mockMatch);
    });
  });

  describe('updateMatchOpponentScores', () => {
    it('should update opponent scores', async () => {
      const mockQuery = createMockQueryBuilder();
      mockQuery.update.mockReturnThis();
      mockQuery.eq.mockResolvedValue({ error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      await updateMatchOpponentScores(
        mockSupabase as any,
        1,
        { id: 1, score: 5, result: 'win' },
        { id: 2, score: 3, result: 'loss' }
      );

      expect(mockQuery.update).toHaveBeenCalledWith({
        opponent1: { id: 1, score: 5, result: 'win' },
        opponent2: { id: 2, score: 3, result: 'loss' },
      });
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

  describe('getMatchWithStage', () => {
    it('should return match with stage info', async () => {
      const mockMatch = {
        id: 1,
        opponent1: { id: 1 },
        opponent2: { id: 2 },
        bracket_stage: { tournament_id: 'event-123' },
      };
      const mockQuery = createMockQueryBuilder();
      mockQuery.select.mockReturnThis();
      mockQuery.eq.mockReturnThis();
      mockQuery.single.mockResolvedValue({ data: mockMatch, error: null });
      mockSupabase.from.mockReturnValue(mockQuery);

      const result = await getMatchWithStage(mockSupabase as any, 1);

      expect(result).toEqual(mockMatch);
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

  describe('assignLaneToMatchRpc', () => {
    it('should return true on successful assignment', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: true, error: null });

      const result = await assignLaneToMatchRpc(mockSupabase as any, 'event-123', 'lane-1', 1);

      expect(result).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('assign_lane_to_match', {
        p_event_id: 'event-123',
        p_lane_id: 'lane-1',
        p_match_id: 1,
      });
    });

    it('should throw BadRequestError when lane not available', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: false, error: null });

      await expect(
        assignLaneToMatchRpc(mockSupabase as any, 'event-123', 'lane-1', 1)
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw InternalError on RPC error', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'RPC failed' } });

      await expect(
        assignLaneToMatchRpc(mockSupabase as any, 'event-123', 'lane-1', 1)
      ).rejects.toThrow(InternalError);
    });
  });
});
