import { eq } from 'drizzle-orm';
import { events } from '@/lib/db/schema';
import type { Tx } from '@/lib/db/tx';
import { bracketExists, getPublicBracket } from '@/lib/services/bracket/bracket-service';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { seedBracket } from './db/seed';

// Anonymous viewer: the real authorizeEventView runs against the test transaction.
const mockDb: { tx?: Tx } = {};
jest.mock('@/lib/db/client', () => ({
  ...jest.requireActual('@/lib/db/client'),
  _getDb: () => mockDb.tx,
}));
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
}));

const db = createTestDb();
afterAll(() => closeDb(db));

describe('public bracket reads', () => {
  it('shows a bracket in play with teams keyed by participant', async () => {
    await withRollback(db, async (tx) => {
      mockDb.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 2 });

      const result = await getPublicBracket(event.eventId);

      expect(result.eventStatus).toBe('bracket');
      expect(result.bracket.matches.length).toBeGreaterThan(0);
      expect(result.teams).toHaveLength(4);
      for (const participant of result.bracket.participants) {
        expect(result.participantTeamMap[Number(participant.id)]).toBeDefined();
      }
      expect(JSON.stringify(result)).not.toMatch(/payment_type|email|access_code/);
      await expect(bracketExists(event.eventId)).resolves.toBe(true);
    });
  });

  it('hides the bracket from anonymous viewers before bracket play', async () => {
    await withRollback(db, async (tx) => {
      mockDb.tx = tx;
      const event = await seedBracket(tx, { teams: 4 });
      await tx.update(events).set({ status: 'pre-bracket' }).where(eq(events.id, event.eventId));

      await expect(getPublicBracket(event.eventId)).rejects.toMatchObject({ name: 'NotFoundError' });
      await expect(bracketExists(event.eventId)).rejects.toMatchObject({ name: 'NotFoundError' });
    });
  });
});
