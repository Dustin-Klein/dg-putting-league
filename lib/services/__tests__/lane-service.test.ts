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
  createMockBracketMatch,
  MockSupabaseClient,
} from './test-utils';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/services/event', () => ({
  requireEventAdmin: jest.fn(),
}));

jest.mock('@/lib/repositories/lane-repository', () => ({
  hasLanes: jest.fn(),
  getLanesForEvent: jest.fn(),
  insertLanes: jest.fn(),
  getMatchLaneAssignments: jest.fn(),
  getEventStatus: jest.fn(),
  getAvailableLanes: jest.fn(),
  getUnassignedReadyMatches: jest.fn(),
  assignLaneToMatch: jest.fn(),
  bulkAssignLanesToMatches: jest.fn(),
  releaseMatchLane: jest.fn(),
  setLaneMaintenanceRPC: jest.fn(),
  setLaneIdleRPC: jest.fn(),
  getLaneById: jest.fn(),
}));

jest.mock('@/lib/repositories/bracket-repository', () => ({
  getBracketStage: jest.fn(),
}));

// Import after mocking
import { createClient } from '@/lib/supabase/server';
import { requireEventAdmin } from '@/lib/services/event';
import * as laneRepo from '@/lib/repositories/lane-repository';
import { getBracketStage } from '@/lib/repositories/bracket-repository';
import {
  createEventLanes,
  getEventLanes,
  getLanesWithMatches,
  autoAssignLanes,
  releaseMatchLaneAndReassign,
  releaseAndReassignLanePublic,
  setLaneMaintenance,
  setLaneIdle,
} from '../lane/lane-service';

describe('Lane Service', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    (requireEventAdmin as jest.Mock).mockResolvedValue({ supabase: mockSupabase });
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
  });

  describe('getLanesWithMatches', () => {
    const eventId = 'event-123';

    it('should return lanes with current match assignments', async () => {
      const mockLanes = [
        createMockLane({ id: 'lane-1', label: 'Lane 1' }),
        createMockLane({ id: 'lane-2', label: 'Lane 2' }),
      ];

      const mockLaneMatchMap = {
        'lane-1': 1,
        // lane-2 has no match
      };

      (laneRepo.getLanesForEvent as jest.Mock).mockResolvedValue(mockLanes);
      (laneRepo.getMatchLaneAssignments as jest.Mock).mockResolvedValue(mockLaneMatchMap);

      const result = await getLanesWithMatches(eventId);

      expect(result).toHaveLength(2);
      expect(result[0].current_match_id).toBe(1);
      expect(result[1].current_match_id).toBeNull();
    });

    it('should handle all lanes without matches', async () => {
      const mockLanes = [createMockLane({ id: 'lane-1' })];

      (laneRepo.getLanesForEvent as jest.Mock).mockResolvedValue(mockLanes);
      (laneRepo.getMatchLaneAssignments as jest.Mock).mockResolvedValue({});

      const result = await getLanesWithMatches(eventId);

      expect(result[0].current_match_id).toBeNull();
    });
  });

  describe('autoAssignLanes', () => {
    const eventId = 'event-123';

    it('should assign available lanes to ready matches', async () => {
      const availableLanes = [
        createMockLane({ id: 'lane-1', status: 'idle' }),
        createMockLane({ id: 'lane-2', status: 'idle' }),
      ];

      const unassignedMatches = [
        createMockBracketMatch({ id: 1 }),
        createMockBracketMatch({ id: 2 }),
      ];

      (laneRepo.getEventStatus as jest.Mock).mockResolvedValue('bracket');
      (laneRepo.getAvailableLanes as jest.Mock).mockResolvedValue(availableLanes);
      (getBracketStage as jest.Mock).mockResolvedValue({ id: 'stage-1' });
      (laneRepo.getUnassignedReadyMatches as jest.Mock).mockResolvedValue(unassignedMatches);
      (laneRepo.bulkAssignLanesToMatches as jest.Mock).mockResolvedValue(2);

      const result = await autoAssignLanes(eventId);

      expect(result).toBe(2);
      expect(laneRepo.bulkAssignLanesToMatches).toHaveBeenCalledTimes(1);
      expect(laneRepo.bulkAssignLanesToMatches).toHaveBeenCalledWith(
        mockSupabase,
        eventId,
        [
          { laneId: 'lane-1', matchId: 1 },
          { laneId: 'lane-2', matchId: 2 },
        ]
      );
    });

    it('should return 0 when event is not in bracket status', async () => {
      (laneRepo.getEventStatus as jest.Mock).mockResolvedValue('pre-bracket');

      const result = await autoAssignLanes(eventId);

      expect(result).toBe(0);
      expect(laneRepo.getAvailableLanes).not.toHaveBeenCalled();
    });

    it('should return 0 when no available lanes', async () => {
      (laneRepo.getEventStatus as jest.Mock).mockResolvedValue('bracket');
      (laneRepo.getAvailableLanes as jest.Mock).mockResolvedValue([]);

      const result = await autoAssignLanes(eventId);

      expect(result).toBe(0);
    });

    it('should return 0 when no bracket stage exists', async () => {
      (laneRepo.getEventStatus as jest.Mock).mockResolvedValue('bracket');
      (laneRepo.getAvailableLanes as jest.Mock).mockResolvedValue([createMockLane()]);
      (getBracketStage as jest.Mock).mockResolvedValue(null);

      const result = await autoAssignLanes(eventId);

      expect(result).toBe(0);
    });

    it('should return 0 when no unassigned matches', async () => {
      (laneRepo.getEventStatus as jest.Mock).mockResolvedValue('bracket');
      (laneRepo.getAvailableLanes as jest.Mock).mockResolvedValue([createMockLane()]);
      (getBracketStage as jest.Mock).mockResolvedValue({ id: 'stage-1' });
      (laneRepo.getUnassignedReadyMatches as jest.Mock).mockResolvedValue([]);

      const result = await autoAssignLanes(eventId);

      expect(result).toBe(0);
    });

    it('should assign minimum of available lanes and matches', async () => {
      const availableLanes = [createMockLane({ id: 'lane-1' })]; // 1 lane
      const unassignedMatches = [
        createMockBracketMatch({ id: 1 }),
        createMockBracketMatch({ id: 2 }),
        createMockBracketMatch({ id: 3 }),
      ]; // 3 matches

      (laneRepo.getEventStatus as jest.Mock).mockResolvedValue('bracket');
      (laneRepo.getAvailableLanes as jest.Mock).mockResolvedValue(availableLanes);
      (getBracketStage as jest.Mock).mockResolvedValue({ id: 'stage-1' });
      (laneRepo.getUnassignedReadyMatches as jest.Mock).mockResolvedValue(unassignedMatches);
      (laneRepo.bulkAssignLanesToMatches as jest.Mock).mockResolvedValue(1);

      const result = await autoAssignLanes(eventId);

      expect(result).toBe(1);
      expect(laneRepo.bulkAssignLanesToMatches).toHaveBeenCalledWith(
        mockSupabase,
        eventId,
        [{ laneId: 'lane-1', matchId: 1 }]
      );
    });

    it('should return count from bulk assignment', async () => {
      const availableLanes = [
        createMockLane({ id: 'lane-1' }),
        createMockLane({ id: 'lane-2' }),
      ];
      const unassignedMatches = [
        createMockBracketMatch({ id: 1 }),
        createMockBracketMatch({ id: 2 }),
      ];

      (laneRepo.getEventStatus as jest.Mock).mockResolvedValue('bracket');
      (laneRepo.getAvailableLanes as jest.Mock).mockResolvedValue(availableLanes);
      (getBracketStage as jest.Mock).mockResolvedValue({ id: 'stage-1' });
      (laneRepo.getUnassignedReadyMatches as jest.Mock).mockResolvedValue(unassignedMatches);
      (laneRepo.bulkAssignLanesToMatches as jest.Mock).mockResolvedValue(1); // Only 1 succeeded

      const result = await autoAssignLanes(eventId);

      expect(result).toBe(1);
    });
  });

  describe('releaseMatchLaneAndReassign', () => {
    const eventId = 'event-123';
    const matchId = 1;

    it('should release lane and trigger auto-assign', async () => {
      (laneRepo.releaseMatchLane as jest.Mock).mockResolvedValue(undefined);
      (laneRepo.getEventStatus as jest.Mock).mockResolvedValue('bracket');
      (laneRepo.getAvailableLanes as jest.Mock).mockResolvedValue([createMockLane({ id: 'lane-1' })]);
      (getBracketStage as jest.Mock).mockResolvedValue({ id: 'stage-1' });
      (laneRepo.getUnassignedReadyMatches as jest.Mock).mockResolvedValue([
        createMockBracketMatch({ id: 2 }),
      ]);
      (laneRepo.bulkAssignLanesToMatches as jest.Mock).mockResolvedValue(1);

      const result = await releaseMatchLaneAndReassign(eventId, matchId);

      expect(laneRepo.releaseMatchLane).toHaveBeenCalledWith(mockSupabase, eventId, matchId);
      expect(result).toBe(1);
    });

    it('should require admin permission', async () => {
      (requireEventAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      await expect(releaseMatchLaneAndReassign(eventId, matchId)).rejects.toThrow(
        'Not authorized'
      );
    });
  });

  describe('releaseAndReassignLanePublic', () => {
    const eventId = 'event-123';
    const matchId = 1;

    it('should release lane using public client', async () => {
      (laneRepo.releaseMatchLane as jest.Mock).mockResolvedValue(undefined);
      (laneRepo.getEventStatus as jest.Mock).mockResolvedValue('bracket');
      (laneRepo.getAvailableLanes as jest.Mock).mockResolvedValue([]);

      const result = await releaseAndReassignLanePublic(eventId, matchId);

      expect(laneRepo.releaseMatchLane).toHaveBeenCalledWith(mockSupabase, eventId, matchId);
      expect(result).toBe(0);
    });

    it('should not require admin permission', async () => {
      (laneRepo.releaseMatchLane as jest.Mock).mockResolvedValue(undefined);
      (laneRepo.getEventStatus as jest.Mock).mockResolvedValue('bracket');
      (laneRepo.getAvailableLanes as jest.Mock).mockResolvedValue([]);

      await releaseAndReassignLanePublic(eventId, matchId);

      expect(requireEventAdmin).not.toHaveBeenCalled();
    });
  });

  describe('setLaneMaintenance', () => {
    const eventId = 'event-123';
    const laneId = 'lane-123';

    it('should set lane to maintenance status', async () => {
      const updatedLane = createMockLane({ id: laneId, status: 'maintenance' });

      (laneRepo.setLaneMaintenanceRPC as jest.Mock).mockResolvedValue(undefined);
      (laneRepo.getLaneById as jest.Mock).mockResolvedValue(updatedLane);

      const result = await setLaneMaintenance(eventId, laneId);

      expect(result).toEqual(updatedLane);
      expect(laneRepo.setLaneMaintenanceRPC).toHaveBeenCalledWith(
        mockSupabase,
        eventId,
        laneId
      );
    });

    it('should require admin permission', async () => {
      (requireEventAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      await expect(setLaneMaintenance(eventId, laneId)).rejects.toThrow('Not authorized');
    });
  });

  describe('setLaneIdle', () => {
    const eventId = 'event-123';
    const laneId = 'lane-123';

    it('should set lane to idle status', async () => {
      const updatedLane = createMockLane({ id: laneId, status: 'idle' });

      (laneRepo.setLaneIdleRPC as jest.Mock).mockResolvedValue(undefined);
      (laneRepo.getLaneById as jest.Mock).mockResolvedValue(updatedLane);

      const result = await setLaneIdle(eventId, laneId);

      expect(result).toEqual(updatedLane);
      expect(laneRepo.setLaneIdleRPC).toHaveBeenCalledWith(mockSupabase, eventId, laneId);
    });

    it('should require admin permission', async () => {
      (requireEventAdmin as jest.Mock).mockRejectedValue(new Error('Not authorized'));

      await expect(setLaneIdle(eventId, laneId)).rejects.toThrow('Not authorized');
    });
  });
});
