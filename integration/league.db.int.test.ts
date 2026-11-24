import { eq } from 'drizzle-orm';
import { events, league_admins } from '@/lib/db/schema';
import { withTransaction } from '@/lib/db/tx';
import { getEventsByLeagueIds } from '@/lib/repositories/event-repository.db';
import {
  fetchLeague,
  getAllLeagues,
  getLeagueAdminRole,
  getLeagueAdminsWithEmails,
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

  it('gets the events of several leagues, newest first, with per-event player and paid counts', async () => {
    await withRollback(db, async (tx) => {
      const first = await seedLeague(tx);
      const second = await seedLeague(tx);
      const older = await seedEvent(tx, { leagueId: first.leagueId, players: 2, status: 'completed' });
      const newer = await seedEvent(tx, { leagueId: first.leagueId, players: 3, status: 'created' });
      const other = await seedEvent(tx, { leagueId: second.leagueId, players: 1, status: 'bracket' });
      await seedEvent(tx, { players: 1, status: 'bracket' });
      await tx.update(events).set({ event_date: '2026-10-01' }).where(eq(events.id, older.eventId));
      await tx.update(events).set({ event_date: '2026-10-09' }).where(eq(events.id, newer.eventId));
      await tx.update(events).set({ event_date: '2026-10-05' }).where(eq(events.id, other.eventId));

      const rows = await getEventsByLeagueIds(tx, [first.leagueId, second.leagueId]);
      expect(rows.map((row) => [row.id, row.league_id, row.participant_count])).toEqual([
        [newer.eventId, first.leagueId, 3],
        [other.eventId, second.leagueId, 1],
        [older.eventId, first.leagueId, 2],
      ]);
      await expect(getEventsByLeagueIds(tx, [])).resolves.toEqual([]);
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
      expect(anonymousList.find((league) => league.id === leagueId)?.events.map((event) => event.id)).toEqual([
        publicEvent.eventId,
      ]);

      const adminList = await getAllLeagues(tx, owner.id);
      expect(adminList.find((league) => league.id === leagueId)?.events.map((event) => event.id).sort()).toEqual(
        [hidden.eventId, publicEvent.eventId].sort()
      );

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

  it('does not reveal a hidden parent event through its visible linked event', async () => {
    const owner = await users.create();
    await withRollback(db, async (tx) => {
      const { leagueId } = await seedLeague(tx);
      const parent = await seedEvent(tx, { leagueId, players: 0, status: 'created' });
      const child = await seedEvent(tx, { leagueId, players: 0, status: 'bracket' });
      await tx.update(events)
        .set({ parent_event_id: parent.eventId, link_type: 'second_chance' })
        .where(eq(events.id, child.eventId));
      await tx.insert(league_admins).values({ league_id: leagueId, user_id: owner.id, role: 'owner' });

      const anonymousDetail = await getLeagueWithEvents(tx, leagueId, null);
      expect(anonymousDetail?.events).toEqual([
        expect.objectContaining({ id: child.eventId, parent_event_id: null, link_type: 'second_chance' }),
      ]);

      const adminDetail = await getLeagueWithEvents(tx, leagueId, owner.id);
      expect(adminDetail?.events).toContainEqual(
        expect.objectContaining({ id: child.eventId, parent_event_id: parent.eventId })
      );
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
        expect.objectContaining({ id: event.leagueId, events: [expect.objectContaining({ id: event.eventId })] })
      );
    });
  });
});
