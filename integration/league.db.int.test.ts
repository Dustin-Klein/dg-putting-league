import { eq } from 'drizzle-orm';
import { events, league_admins } from '@/lib/db/schema';
import { withTransaction } from '@/lib/db/tx';
import {
  fetchLeague,
  getAllLeagues,
  getLeagueAdminRole,
  getLeagueAdminsWithEmails,
  getLeagueEventStats,
  getLeagueWithEvents,
  getUserIdByEmail,
  insertLeague,
  insertLeagueAdmin,
} from '@/lib/repositories/league-repository.db';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { seedEvent, seedLeague } from './db/seed';
import { testUsers } from './db/users';

const db = createTestDb();
const users = testUsers();

afterAll(async () => {
  await users.cleanup();
  await closeDb(db);
});

describe('league Drizzle repository', () => {
  it('creates a league and its owner atomically and reads it back in the transaction', async () => {
    const owner = await users.create();
    await withRollback(db, async (tx) => {
      const leagueId = crypto.randomUUID();
      const league = await withTransaction(tx, async (nested) => {
        await insertLeague(nested, leagueId, 'Transactional League', 'Madison');
        await insertLeagueAdmin(nested, leagueId, owner.id, 'owner');
        return fetchLeague(nested, leagueId);
      });

      expect(league).toMatchObject({
        id: leagueId,
        name: 'Transactional League',
        city: 'Madison',
      });
      await expect(getLeagueAdminRole(tx, leagueId, owner.id)).resolves.toBe('owner');
    });
  });

  it('loads all league admins and their emails with the joined query', async () => {
    const owner = await users.create();
    const admin = await users.create();
    await withRollback(db, async (tx) => {
      const { leagueId } = await seedLeague(tx);
      await tx.insert(league_admins).values([
        { league_id: leagueId, user_id: owner.id, role: 'owner' },
        { league_id: leagueId, user_id: admin.id, role: 'admin' },
      ]);

      await expect(getLeagueAdminsWithEmails(tx, leagueId)).resolves.toEqual(
        expect.arrayContaining([
          { user_id: owner.id, role: 'owner', email: owner.email },
          { user_id: admin.id, role: 'admin', email: admin.email },
        ])
      );
    });
  });

  it('finds auth users by a trimmed, case-insensitive email', async () => {
    const account = await users.create(`Mixed-${crypto.randomUUID()}@Example.Test`);
    await expect(getUserIdByEmail(db, `  ${account.email.toUpperCase()}  `)).resolves.toBe(account.id);
  });

  it('gets total, active, and latest event data for all league ids in one grouped lookup', async () => {
    await withRollback(db, async (tx) => {
      const first = await seedLeague(tx);
      const second = await seedLeague(tx);
      const firstCreated = await seedEvent(tx, { leagueId: first.leagueId, players: 0, status: 'created' });
      const firstCompleted = await seedEvent(tx, { leagueId: first.leagueId, players: 0, status: 'completed' });
      await seedEvent(tx, { leagueId: second.leagueId, players: 0, status: 'bracket' });
      await tx.update(events).set({ event_date: '2026-10-01' }).where(eq(events.id, firstCreated.eventId));
      await tx.update(events).set({ event_date: '2026-10-09' }).where(eq(events.id, firstCompleted.eventId));

      const stats = await getLeagueEventStats(tx, [first.leagueId, second.leagueId]);
      expect(stats).toEqual(
        expect.arrayContaining([
          {
            league_id: first.leagueId,
            event_count: 2,
            active_event_count: 1,
            last_event_date: '2026-10-09',
          },
          {
            league_id: second.leagueId,
            event_count: 1,
            active_event_count: 1,
            last_event_date: '2026-10-08',
          },
        ])
      );
    });
  });

  it('applies public event visibility and groups participant counts', async () => {
    const owner = await users.create();
    await withRollback(db, async (tx) => {
      const { leagueId } = await seedLeague(tx);
      const hidden = await seedEvent(tx, { leagueId, players: 1, status: 'created' });
      const publicEvent = await seedEvent(tx, { leagueId, players: 2, status: 'bracket' });
      await tx.insert(league_admins).values({
        league_id: leagueId,
        user_id: owner.id,
        role: 'owner',
      });

      const anonymousList = await getAllLeagues(tx, null);
      expect(anonymousList).toContainEqual(expect.objectContaining({ id: leagueId, event_count: 1 }));

      const adminList = await getAllLeagues(tx, owner.id);
      expect(adminList).toContainEqual(expect.objectContaining({ id: leagueId, event_count: 2 }));

      const anonymousDetail = await getLeagueWithEvents(tx, leagueId, null);
      expect(anonymousDetail?.events).toEqual([
        expect.objectContaining({ id: publicEvent.eventId, participant_count: 2 }),
      ]);

      const adminDetail = await getLeagueWithEvents(tx, leagueId, owner.id);
      expect(adminDetail?.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: hidden.eventId, participant_count: 1 }),
          expect.objectContaining({ id: publicEvent.eventId, participant_count: 2 }),
        ])
      );
      expect(adminDetail?.event_count).toBe(2);
    });
  });

  it('hides a league whose only event is private from anonymous viewers', async () => {
    const owner = await users.create();
    await withRollback(db, async (tx) => {
      const event = await seedEvent(tx, { players: 0, status: 'created' });
      await tx.insert(league_admins).values({
        league_id: event.leagueId,
        user_id: owner.id,
        role: 'owner',
      });

      await expect(getAllLeagues(tx, null)).resolves.not.toContainEqual(
        expect.objectContaining({ id: event.leagueId })
      );
      await expect(getAllLeagues(tx, owner.id)).resolves.toContainEqual(
        expect.objectContaining({ id: event.leagueId, event_count: 1 })
      );
    });
  });
});
