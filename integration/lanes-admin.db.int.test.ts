import type { Executor } from '@/lib/db/tx';
import { addLanes, deleteLane } from '@/lib/services/lane/lane-service';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, seedBracket } from './db/seed';

const admin: { tx?: Executor } = {};
jest.mock('@/lib/services/event', () => ({
  requireEventAdmin: async () => ({ pg: admin.tx, supabase: null, user: { id: 'integration-admin' } }),
}));

const db = createTestDb();
afterAll(() => closeDb(db));

describe('lane admin operations (Drizzle)', () => {
  it('adds lanes and deletes an idle lane', async () => {
    await withRollback(db, async (tx) => {
      admin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 2 });
      const added = await addLanes(event.eventId, 2);
      expect(added.map((lane) => lane.label)).toEqual(['Lane 3', 'Lane 4']);
      expect(await deleteLane(event.eventId, added[0].id)).toBe(true);
      expect((await getBracketSnapshot(tx, event.eventId)).lanes.map((lane) => lane.label)).not.toContain('Lane 3');
    });
  });

  it('refuses to delete a lane while a match is assigned', async () => {
    await withRollback(db, async (tx) => {
      admin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 2 });
      const occupied = (await getBracketSnapshot(tx, event.eventId)).lanes.find((lane) => lane.status === 'occupied');
      expect(occupied).toBeDefined();
      expect(await deleteLane(event.eventId, occupied!.id)).toBe(false);
    });
  });
});
