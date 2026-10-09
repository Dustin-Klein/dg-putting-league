import { eq } from 'drizzle-orm';
import { players } from '@/lib/db/schema';
import {
  getPlayerIdsInEvent,
  insertPlayer,
  searchPlayersByName,
  searchPlayersByNumber,
} from '@/lib/repositories/player-repository.db';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { seedEvent } from './db/seed';

const db = createTestDb();
afterAll(() => closeDb(db));

describe('player repository (drizzle)', () => {
  it('inserts a player and retrieves by id', async () => {
    await withRollback(db, async (tx) => {
      const created = await insertPlayer(tx, {
        full_name: 'Test Disc Golfer',
        email: 'test@example.com',
        nickname: 'Ace',
        default_pool: 'A',
      });

      expect(created.id).toBeDefined();

      const [row] = await tx
        .select()
        .from(players)
        .where(eq(players.id, created.id));

      expect(row).toBeDefined();
      expect(row.full_name).toBe('Test Disc Golfer');
      expect(row.email).toBe('test@example.com');
      expect(row.nickname).toBe('Ace');
      expect(row.default_pool).toBe('A');
      expect(row.player_number).toBeGreaterThan(0);
    });
  });

  it('searches players by name with literal wildcards', async () => {
    await withRollback(db, async (tx) => {
      // Insert players: one with literal % and _
      const p1 = await insertPlayer(tx, { full_name: 'Regular Name' });
      const p2 = await insertPlayer(tx, { full_name: '100%_Legend' });
      const p3 = await insertPlayer(tx, { full_name: '1000_Legend' });

      // Search for literal '100%_' - should match p2 only, not p3
      const literalResults = await searchPlayersByName(tx, '100%_');
      const literalIds = literalResults.map((r) => r.id);
      expect(literalIds).toContain(p2.id);
      expect(literalIds).not.toContain(p3.id);
      expect(literalIds).not.toContain(p1.id);

      // Search for 'Regular'
      const nameResults = await searchPlayersByName(tx, 'Regular');
      expect(nameResults.map((r) => r.id)).toContain(p1.id);
    });
  });

  it('searches players by number', async () => {
    await withRollback(db, async (tx) => {
      const created = await insertPlayer(tx, { full_name: 'Numbered Player' });

      const [row] = await tx
        .select({ player_number: players.player_number })
        .from(players)
        .where(eq(players.id, created.id));

      const results = await searchPlayersByNumber(tx, row.player_number);
      expect(results.length).toBeGreaterThanOrEqual(1);
      const match = results.find((r) => r.id === created.id);
      expect(match).toBeDefined();
      expect(match?.full_name).toBe('Numbered Player');
      expect(match?.player_number).toBe(row.player_number);
    });
  });

  it('fetches player IDs in an event with getPlayerIdsInEvent', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedEvent(tx, { players: 2 });

      const playerIds = await getPlayerIdsInEvent(tx, event.eventId);
      expect(playerIds.sort()).toEqual(event.playerIds.sort());
    });
  });
});
