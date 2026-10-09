/**
 * Lane Service Tests
 *
 * Tests for lane management functions:
 * - createEventLanes()
 * - getEventLanes()
 * - getLanesWithMatches()
 * - autoAssignLanes()
 * - releaseMatchLaneAndReassign()
 * - releaseAndReassignLanePublic()
 * - setLaneMaintenance()
 * - setLaneIdle()
 */

import {
  createMockSupabaseClient,
  createMockLane,
  createMockUser,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/services/event', () => ({
  requireEventAdmin: jest.fn(),
}));

jest.mock('@/lib/services/auth', () => ({
  authorizeEventView: jest.fn(),
}));

jest.mock('@/lib/db/tx', () => ({
  lockEvent: jest.fn(),
  lockMatch: jest.fn(),
  withTransaction: jest.fn(async (ex, fn) => fn(ex)),
}));

jest.mock('@/lib/repositories/event-repository.db', () => ({
  getEventBracketConfig: jest.fn().mockResolvedValue({ status: 'bracket' }),
}));

jest.mock('@/lib/repositories/lane-repository.db', () => ({
  hasLanes: jest.fn(),
  getLanesForEvent: jest.fn(),
  insertLanes: jest.fn(),
  getMatchLaneAssignments: jest.fn(),
  lockEventLanes: jest.fn(),
}));

jest.mock('@/lib/repositories/bracket-repository.db', () => ({
  getStageForEvent: jest.fn(),
  fetchBracketStructure: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { requireEventAdmin } from '@/lib/services/event';
import { authorizeEventView } from '@/lib/services/auth';
import * as laneRepo from '@/lib/repositories/lane-repository.db';
import { fetchBracketStructure } from '@/lib/repositories/bracket-repository.db';
import {
  createEventLanes,
  getEventLanes,
  getLanesWithMatches,
  resolveMatchDisplayNumber,
} from '../lane/lane-service';

describe('Lane Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireEventAdmin as jest.Mock).mockResolvedValue({ pg: mockSupabase, user: createMockUser({ id: 'user-123' }) });
    (authorizeEventView as jest.Mock).mockResolvedValue({ pg: mockSupabase });
  });

  describe('createEventLanes', () => {
    const eventId = 'event-123';
    const laneCount = 4;

    it('should create lanes when none exist', async () => {
      const expectedLanes = [
        createMockLane({ id: 'lane-1', label: 'Lane 1' }),
        createMockLane({ id: 'lane-2', label: 'Lane 2' }),
        createMockLane({ id: 'lane-3', label: 'Lane 3' }),
        createMockLane({ id: 'lane-4', label: 'Lane 4' }),
      ];

      (laneRepo.hasLanes as jest.Mock).mockResolvedValue(false);
      (laneRepo.insertLanes as jest.Mock).mockResolvedValue(expectedLanes);

      const result = await createEventLanes(eventId, laneCount);

      expect(result).toEqual(expectedLanes);
      expect(laneRepo.insertLanes).toHaveBeenCalledWith(mockSupabase, eventId, laneCount);
    });

    it('should return existing lanes when they already exist', async () => {
      const existingLanes = [
        createMockLane({ id: 'lane-1', label: 'Lane 1' }),
        createMockLane({ id: 'lane-2', label: 'Lane 2' }),
      ];

      (laneRepo.hasLanes as jest.Mock).mockResolvedValue(true);
      (laneRepo.getLanesForEvent as jest.Mock).mockResolvedValue(existingLanes);

      const result = await createEventLanes(eventId, laneCount);

      expect(result).toEqual(existingLanes);
      expect(laneRepo.insertLanes).not.toHaveBeenCalled();
    });

    it('should require admin permission', async () => {
      (requireEventAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      await expect(createEventLanes(eventId, laneCount)).rejects.toThrow('Not authorized');
    });
  });

  describe('getEventLanes', () => {
    const eventId = 'event-123';

    it('should return lanes for event', async () => {
      const mockLanes = [
        createMockLane({ id: 'lane-1', label: 'Lane 1' }),
        createMockLane({ id: 'lane-2', label: 'Lane 2' }),
      ];

      (laneRepo.getLanesForEvent as jest.Mock).mockResolvedValue(mockLanes);

      const result = await getEventLanes(eventId);

      expect(result).toEqual(mockLanes);
      expect(laneRepo.getLanesForEvent).toHaveBeenCalledWith(mockSupabase, eventId);
    });

    it('should return empty array when no lanes exist', async () => {
      (laneRepo.getLanesForEvent as jest.Mock).mockResolvedValue([]);

      const result = await getEventLanes(eventId);

      expect(result).toEqual([]);
    });

    it('does not query lanes when the event is not visible', async () => {
      (authorizeEventView as jest.Mock).mockRejectedValue(new Error('Event not found'));

      await expect(getEventLanes(eventId)).rejects.toThrow('Event not found');
      expect(laneRepo.getLanesForEvent).not.toHaveBeenCalled();
    });
  });

  describe('getLanesWithMatches', () => {
    const eventId = 'event-123';

    const mockBracketStructure = {
      stage: { id: 1 },
      groups: [{ id: 10, number: 1 }],
      rounds: [{ id: 100, group_id: 10, number: 1 }],
      matches: [
        { id: 1, round_id: 100, number: 1, status: 2, opponent1: { id: 1 }, opponent2: { id: 2 } },
        { id: 2, round_id: 100, number: 2, status: 2, opponent1: { id: 3 }, opponent2: { id: 4 } },
      ],
      participants: [],
    };

    it('should return lanes with current match assignments', async () => {
      const mockLanes = [
        createMockLane({ id: 'lane-1', label: 'Lane 1' }),
        createMockLane({ id: 'lane-2', label: 'Lane 2' }),
      ];

      const mockLaneMatchMap = {
        'lane-1': { id: 2, number: 2 },
        // lane-2 has no match
      };

      (laneRepo.getLanesForEvent as jest.Mock).mockResolvedValue(mockLanes);
      (laneRepo.getMatchLaneAssignments as jest.Mock).mockResolvedValue(mockLaneMatchMap);
      (fetchBracketStructure as jest.Mock).mockResolvedValue(mockBracketStructure);

      const result = await getLanesWithMatches(eventId);

      expect(result).toHaveLength(2);
      expect(result[0].current_match_id).toBe(2);
      expect(result[0].current_match_number).toBe(2);
      expect(result[1].current_match_id).toBeNull();
      expect(result[1].current_match_number).toBeNull();
    });

    it('should handle all lanes without matches', async () => {
      const mockLanes = [createMockLane({ id: 'lane-1' })];

      (laneRepo.getLanesForEvent as jest.Mock).mockResolvedValue(mockLanes);
      (laneRepo.getMatchLaneAssignments as jest.Mock).mockResolvedValue({});
      (fetchBracketStructure as jest.Mock).mockResolvedValue(mockBracketStructure);

      const result = await getLanesWithMatches(eventId);

      expect(result[0].current_match_id).toBeNull();
      expect(result[0].current_match_number).toBeNull();
    });
  });

  describe('resolveMatchDisplayNumber', () => {
    it('does not query bracket data when visibility authorization fails', async () => {
      (authorizeEventView as jest.Mock).mockRejectedValueOnce(new Error('Event not found'));
      await expect(resolveMatchDisplayNumber('event-123', 1)).rejects.toThrow('Event not found');
      expect(fetchBracketStructure).not.toHaveBeenCalled();
    });
  });


});
