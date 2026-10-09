import { eq } from 'drizzle-orm';
import { bracket_match, event_placements, events } from '@/lib/db/schema';
import { withTransaction } from '@/lib/db/tx';
import { updateEventSettingsTx } from '@/lib/services/event/event-service';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, seedBracket } from './db/seed';

const db = createTestDb();
afterAll(() => closeDb(db));

async function decideGrandFinal(
  tx: Parameters<Parameters<typeof withRollback>[1]>[0],
  eventId: string
): Promise<void> {
  const snapshot = await getBracketSnapshot(tx, eventId);
  const grandFinal = snapshot.matches.find(
    (match) => match.group_number === 3 && match.round_number === 1 && match.number === 1
  );
  if (!grandFinal || snapshot.participants.length < 2) throw new Error('Grand final seed failed');
  await tx.update(bracket_match).set({
    status: 4,
    opponent1: { id: snapshot.participants[0].id, result: 'win' },
    opponent2: { id: snapshot.participants[1].id, result: 'loss' },
  }).where(eq(bracket_match.id, grandFinal.id));
}

describe('updateEventSettingsTx', () => {
  it('rejects an undecided bracket unless force is set', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      await expect(updateEventSettingsTx(tx, event.eventId, { status: 'completed' }))
        .rejects.toMatchObject({ name: 'ConflictError' });

      const [before] = await tx.select({ status: events.status }).from(events).where(eq(events.id, event.eventId));
      expect(before.status).toBe('bracket');

      await updateEventSettingsTx(tx, event.eventId, { status: 'completed', force: true });
      const [after] = await tx.select({ status: events.status }).from(events).where(eq(events.id, event.eventId));
      expect(after.status).toBe('completed');
    });
  });

  it('writes decided placements and completed status together', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      await decideGrandFinal(tx, event.eventId);
      await updateEventSettingsTx(tx, event.eventId, { status: 'completed' });

      const [row] = await tx.select({ status: events.status }).from(events).where(eq(events.id, event.eventId));
      const placements = await tx.select().from(event_placements).where(eq(event_placements.event_id, event.eventId));
      expect(row.status).toBe('completed');
      expect(placements.map((placement) => placement.placement).sort()).toEqual([1, 2]);
    });
  });

  it('rolls back both placements and status when the transaction fails', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      await decideGrandFinal(tx, event.eventId);

      await expect(withTransaction(tx, async (nested) => {
        await updateEventSettingsTx(nested, event.eventId, { status: 'completed' });
        throw new Error('forced failure');
      })).rejects.toThrow('forced failure');

      const [row] = await tx.select({ status: events.status }).from(events).where(eq(events.id, event.eventId));
      const placements = await tx.select().from(event_placements).where(eq(event_placements.event_id, event.eventId));
      expect(row.status).toBe('bracket');
      expect(placements).toHaveLength(0);
    });
  });
});
