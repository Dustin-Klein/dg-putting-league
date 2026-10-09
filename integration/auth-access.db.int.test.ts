import { eq } from 'drizzle-orm';
import { user_emails } from '@/lib/db/auth-schema';
import { league_admins } from '@/lib/db/schema';
import { getEventAccess } from '@/lib/repositories/event-repository.db';
import { getLeagueAdminRole, isAnyLeagueAdmin } from '@/lib/repositories/league-repository.db';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { seedEvent } from './db/seed';
import { testUsers } from './db/users';

const db = createTestDb();
const users = testUsers();
afterAll(async () => {
  await users.cleanup();
  await closeDb(db);
});

describe('authorization lookups', () => {
  it('loads an event with the viewer role in one query', async () => {
    const admin = await users.create();
    const outsider = await users.create();
    await withRollback(db, async (tx) => {
      const event = await seedEvent(tx, { players: 0, status: 'pre-bracket' });
      await tx.insert(league_admins).values({ league_id: event.leagueId, user_id: admin.id, role: 'owner' });

      await expect(getEventAccess(tx, event.eventId, admin.id)).resolves.toMatchObject({
        id: event.eventId,
        league_id: event.leagueId,
        status: 'pre-bracket',
        admin_role: 'owner',
      });
      await expect(getEventAccess(tx, event.eventId, outsider.id)).resolves.toMatchObject({ admin_role: null });
      await expect(getEventAccess(tx, event.eventId, null)).resolves.toMatchObject({ admin_role: null });
      await expect(getEventAccess(tx, '00000000-0000-4000-8000-000000000000', admin.id)).resolves.toBeNull();

      await expect(getLeagueAdminRole(tx, event.leagueId, admin.id)).resolves.toBe('owner');
      await expect(getLeagueAdminRole(tx, event.leagueId, outsider.id)).resolves.toBeNull();
      await expect(isAnyLeagueAdmin(tx, admin.id)).resolves.toBe(true);
      await expect(isAnyLeagueAdmin(tx, outsider.id)).resolves.toBe(false);
    });
  });

  it('reads account emails through app_private.user_emails', async () => {
    const user = await users.create();
    const rows = await db.select().from(user_emails).where(eq(user_emails.id, user.id));
    expect(rows).toEqual([{ id: user.id, email: user.email }]);
  });
});
