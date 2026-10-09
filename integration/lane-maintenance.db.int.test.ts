import { eq } from 'drizzle-orm';
import { bracket_match } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/tx';
import { setLaneMaintenance } from '@/lib/services/lane/lane-service';
import { MatchStatus } from '@/lib/types/bracket';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, seedBracket } from './db/seed';

const mockAdmin: { tx?: Executor } = {};
jest.mock('@/lib/services/event', () => ({
  requireEventAdmin: async () => ({ pg: mockAdmin.tx, supabase: null, user: { id: null } }),
}));
jest.mock('@/lib/repositories/lane-repository', () => {
  const actual = jest.requireActual<typeof import('@/lib/repositories/lane-repository')>(
    '@/lib/repositories/lane-repository'
  );
  return {
    ...actual,
    getLaneById: jest.fn().mockResolvedValue({ id: 'unused', label: 'unused', status: 'maintenance' }),
  };
});

const db = createTestDb();
afterAll(() => closeDb(db));

describe('lane maintenance', () => {
  it('requires confirmation for a running match, then moves it to the next idle lane', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 3 });
      const before = await getBracketSnapshot(tx, event.eventId);
      const running = before.matches.find((match) => match.lane_id !== null)!;
      const oldLaneId = running.lane_id!;
      await tx.update(bracket_match)
        .set({ status: MatchStatus.Running })
        .where(eq(bracket_match.id, running.id));

      await expect(setLaneMaintenance(event.eventId, oldLaneId)).rejects.toThrow(
        'This lane has a match in progress. Confirm to move it off the lane.'
      );
      expect((await getBracketSnapshot(tx, event.eventId)).matches.find((m) => m.id === running.id)?.lane_id)
        .toBe(oldLaneId);

      await setLaneMaintenance(event.eventId, oldLaneId, true);
      const after = await getBracketSnapshot(tx, event.eventId);
      const moved = after.matches.find((match) => match.id === running.id)!;
      expect(moved.lane_id).not.toBeNull();
      expect(moved.lane_id).not.toBe(oldLaneId);
      expect(moved.lane_assigned_at).not.toBeNull();
      expect(after.lanes.find((lane) => lane.id === oldLaneId)?.status).toBe('maintenance');
    });
  });

  it('clears lane_assigned_at when no replacement lane exists', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 1 });
      const before = await getBracketSnapshot(tx, event.eventId);
      const running = before.matches.find((match) => match.lane_id !== null)!;
      await tx.update(bracket_match)
        .set({ status: MatchStatus.Running })
        .where(eq(bracket_match.id, running.id));

      await setLaneMaintenance(event.eventId, running.lane_id!, true);
      const [stored] = await tx.select().from(bracket_match).where(eq(bracket_match.id, running.id));
      expect(stored.lane_id).toBeNull();
      expect(stored.lane_assigned_at).toBeNull();
    });
  });
});
