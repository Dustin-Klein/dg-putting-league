import { eq } from 'drizzle-orm';
import { bracket_match } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/tx';
import { resetMatchResult } from '@/lib/services/bracket/bracket-service';
import {
  releaseLane,
  setLaneIdle,
  setLaneMaintenance,
} from '@/lib/services/lane/lane-service';
import { completeMatch } from '@/lib/services/scoring/match-completion';
import { MatchStatus } from '@/lib/types/bracket';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, seedBracket } from './db/seed';

const mockAdmin: { tx?: Executor } = {};
jest.mock('@/lib/services/event', () => ({
  requireEventAdmin: async () => ({ pg: mockAdmin.tx, supabase: null, user: { id: null } }),
}));

const db = createTestDb();
afterAll(() => closeDb(db));

async function markRunning(ex: Executor, matchId: number): Promise<void> {
  await ex.update(bracket_match)
    .set({ status: MatchStatus.Running })
    .where(eq(bracket_match.id, matchId));
}

describe('lane maintenance', () => {
  it('defers maintenance on a running lane until the match completes', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 3 });
      const before = await getBracketSnapshot(tx, event.eventId);
      const running = before.matches.find((match) => match.lane_id !== null)!;
      const laneId = running.lane_id!;
      await markRunning(tx, running.id);

      await setLaneMaintenance(event.eventId, laneId);
      let snapshot = await getBracketSnapshot(tx, event.eventId);
      expect(snapshot.matches.find((match) => match.id === running.id)?.lane_id).toBe(laneId);
      expect(snapshot.lanes.find((lane) => lane.id === laneId)).toMatchObject({
        status: 'occupied',
        maintenance_pending: true,
      });

      await completeMatch(tx, event.eventId, running.id, { team1Score: 10, team2Score: 5 });
      snapshot = await getBracketSnapshot(tx, event.eventId);
      expect(snapshot.lanes.find((lane) => lane.id === laneId)).toMatchObject({
        status: 'maintenance',
        maintenance_pending: false,
      });
      expect(snapshot.matches.some((match) => match.lane_id === laneId)).toBe(false);
    });
  });

  it('maintenance now leaves a running match laneless and does not reassign it', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 3 });
      const before = await getBracketSnapshot(tx, event.eventId);
      const running = before.matches.find((match) => match.lane_id !== null)!;
      const laneId = running.lane_id!;
      await markRunning(tx, running.id);

      await setLaneMaintenance(event.eventId, laneId, 'now');
      const after = await getBracketSnapshot(tx, event.eventId);
      expect(after.matches.find((match) => match.id === running.id)).toMatchObject({
        lane_id: null,
        lane_assigned_at: null,
        status: MatchStatus.Running,
      });
      expect(after.lanes.find((lane) => lane.id === laneId)).toMatchObject({
        status: 'maintenance',
        maintenance_pending: false,
      });
    });
  });

  it('moves a ready, unscored match to another idle lane', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 3 });
      const before = await getBracketSnapshot(tx, event.eventId);
      const ready = before.matches.find((match) => match.lane_id !== null)!;
      const oldLaneId = ready.lane_id!;

      await setLaneMaintenance(event.eventId, oldLaneId);
      const after = await getBracketSnapshot(tx, event.eventId);
      const reassigned = after.matches.find((match) => match.id === ready.id)!;
      expect(reassigned.lane_id).not.toBeNull();
      expect(reassigned.lane_id).not.toBe(oldLaneId);
      expect(after.lanes.find((lane) => lane.id === oldLaneId)?.status).toBe('maintenance');
    });
  });

  it('cancels pending maintenance without taking a running match off its lane', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 2 });
      const before = await getBracketSnapshot(tx, event.eventId);
      const running = before.matches.find((match) => match.lane_id !== null)!;
      const laneId = running.lane_id!;
      await markRunning(tx, running.id);
      await setLaneMaintenance(event.eventId, laneId, 'after_match');

      await setLaneIdle(event.eventId, laneId);
      const after = await getBracketSnapshot(tx, event.eventId);
      expect(after.matches.find((match) => match.id === running.id)?.lane_id).toBe(laneId);
      expect(after.lanes.find((lane) => lane.id === laneId)).toMatchObject({
        status: 'occupied',
        maintenance_pending: false,
      });
    });
  });

  it('rejects release of a running match unless forced, while ready matches still release', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 2 });
      const before = await getBracketSnapshot(tx, event.eventId);
      const assigned = before.matches.filter((match) => match.lane_id !== null);
      const running = assigned[0];
      const ready = assigned[1];
      await markRunning(tx, running.id);

      await expect(releaseLane(event.eventId, running.lane_id!, running.id)).rejects.toThrow(
        'This match is being scored. Use "Maintenance now" to force it off the lane.'
      );
      expect(await releaseLane(event.eventId, running.lane_id!, running.id, true)).toBe(true);
      expect(await releaseLane(event.eventId, ready.lane_id!, ready.id)).toBe(true);

      const after = await getBracketSnapshot(tx, event.eventId);
      expect(after.matches.find((match) => match.id === running.id)?.lane_id).toBeNull();
      expect(after.matches.find((match) => match.id === ready.id)?.lane_id).toBeNull();
    });
  });

  it('puts a pending lane into maintenance when its running match is reset', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 2 });
      const before = await getBracketSnapshot(tx, event.eventId);
      const running = before.matches.find((match) => match.lane_id !== null)!;
      const laneId = running.lane_id!;
      await markRunning(tx, running.id);
      await setLaneMaintenance(event.eventId, laneId, 'after_match');

      await resetMatchResult(event.eventId, running.id);
      const after = await getBracketSnapshot(tx, event.eventId);
      expect(after.matches.find((match) => match.id === running.id)?.lane_id).toBeNull();
      expect(after.lanes.find((lane) => lane.id === laneId)).toMatchObject({
        status: 'maintenance',
        maintenance_pending: false,
      });
    });
  });
});
