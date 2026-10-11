import { BracketsManager } from 'brackets-manager';
import { getBracketResetContext } from '@/lib/repositories/bracket-repository.db';
import { DrizzleBracketStorage } from '@/lib/repositories/bracket-storage.db';
import { snapshotStorage } from '@/lib/services/bracket/bracket-service';
import type { Tx } from '@/lib/db/tx';
import { closeDb, createCountingTestDb, withRollback } from './db/harness';
import { seedBracket } from './db/seed';
import { playMatch, playableMatches } from './db/play';
import { getBracketSnapshot } from './db/seed';

const counting = createCountingTestDb();
afterAll(() => closeDb(counting.db));

/** Every match's next matches, from the database and from the in-memory snapshot. */
async function nextMatchesBothWays(tx: Tx, eventId: string) {
  const context = (await getBracketResetContext(tx, eventId))!;
  const fromDb = new BracketsManager(new DrizzleBracketStorage(tx, eventId)).find;
  const fromSnapshot = new BracketsManager(snapshotStorage(context)).find;

  const expected: Record<number, number[]> = {};
  const actual: Record<number, number[]> = {};
  let snapshotQueries = 0;
  for (const match of context.matches) {
    expected[match.id] = (await fromDb.nextMatches(match.id)).map((m) => Number(m.id));
    const { total } = await counting.count(async () => {
      actual[match.id] = (await fromSnapshot.nextMatches(match.id)).map((m) => Number(m.id));
    });
    snapshotQueries += total;
  }
  return { expected, actual, snapshotQueries };
}

describe('reset graph traversal over the loaded snapshot', () => {
  it.each([
    { teams: 2, doubleGrandFinal: true },
    { teams: 5, doubleGrandFinal: true },
    { teams: 8, doubleGrandFinal: false },
    { teams: 13, doubleGrandFinal: true },
    { teams: 16, doubleGrandFinal: true },
  ])('finds the same next matches as the database for $teams teams (double GF: $doubleGrandFinal)', async (opts) => {
    await withRollback(counting.db, async (tx) => {
      const event = await seedBracket(tx, { ...opts, laneCount: 2 });

      const fresh = await nextMatchesBothWays(tx, event.eventId);
      expect(fresh.actual).toEqual(fresh.expected);
      expect(fresh.snapshotQueries).toBe(0);

      // Part-way through, after progression has rewritten opponents.
      for (let i = 0; i < opts.teams; i++) {
        const [next] = playableMatches(await getBracketSnapshot(tx, event.eventId));
        if (!next) break;
        await playMatch(tx, event.eventId, next.id, i % 2 === 0 ? 'opponent1' : 'opponent2');
      }
      const played = await nextMatchesBothWays(tx, event.eventId);
      expect(played.actual).toEqual(played.expected);
      expect(played.snapshotQueries).toBe(0);
    });
  });
});
