/**
 * Lanes lent from a main event to its second chance: who may use them, when they can
 * move, and that concurrent scoring on both events never double-books or strands one.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { bracket_match, event_players, events, lane_loans, lanes, players } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/tx';
import { createSecondChanceEvent, deleteEvent, startBracket, updateEventSettingsTx } from '@/lib/services/event/event-service';
import { addLanes, getLaneLoans, lendLanes, returnLanes } from '@/lib/services/lane';
import { getLanesForEvent } from '@/lib/repositories/lane-repository.db';
import { withTransaction } from '@/lib/db/tx';
import { MatchStatus } from '@/lib/types/bracket';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { playMatch, playableMatches } from './db/play';
import { cleanupLeague, getBracketSnapshot, seedBracket, type SeededEvent } from './db/seed';

const mockAuth: { pg?: Executor } = {};
jest.mock('@/lib/services/auth', () => ({
  authorizeEventAdmin: async () => ({ user: { id: 'integration-user' }, event: {}, pg: mockAuth.pg }),
  authorizeLeagueAdmin: async () => ({ user: { id: 'integration-user' }, pg: mockAuth.pg }),
  authorizeEventView: async (eventId: string) => ({
    user: { id: 'integration-user' },
    event: { id: eventId },
    isAdmin: true,
    pg: mockAuth.pg,
  }),
}));

const db = createTestDb(10);
const committed: SeededEvent[] = [];
afterAll(async () => {
  for (const event of committed) await cleanupLeague(db, event);
  await closeDb(db);
});

const accessCode = () => `ln${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const OPEN = new Set<number>([MatchStatus.Waiting, MatchStatus.Ready, MatchStatus.Running]);

/** A single-elimination main event (8 doubles teams) with one quarterfinal played and a second chance. */
async function mainWithSecondChance(ex: Executor, laneCount = 4) {
  const parent = await seedBracket(ex, { teams: 8, laneCount, bracketFormat: 'single_elimination' });
  const child = await createSecondChanceEvent(parent.eventId, { access_code: accessCode() });
  return { parent, childId: child.id };
}

/** Knock out enough main-event teams to give the second chance `entrants` players, then start it. */
async function startSecondChance(ex: Executor, parent: SeededEvent, childId: string): Promise<void> {
  for (const match of playableMatches(await getBracketSnapshot(ex, parent.eventId)).filter((m) => m.round_number === 1)) {
    await playMatch(ex, parent.eventId, match.id, 'opponent1');
  }
  const { syncSecondChancePlayers } = await import('@/lib/services/event/second-chance');
  await syncSecondChancePlayers(childId);
  await ex.update(event_players).set({ payment_type: 'cash' }).where(eq(event_players.event_id, childId));
  await ex.update(events).set({ status: 'pre-bracket' }).where(eq(events.id, childId));

  const entrants = await ex
    .select({ id: event_players.id, player_id: event_players.player_id, name: players.full_name })
    .from(event_players)
    .innerJoin(players, eq(players.id, event_players.player_id))
    .where(eq(event_players.event_id, childId));
  const scores = entrants.map((entrant, i) => ({
    eventPlayerId: entrant.id,
    playerId: entrant.player_id,
    playerName: entrant.name,
    pfaScore: 100 - i,
    scoringMethod: 'default' as const,
    defaultPool: 'A' as const,
  }));
  await startBracket(ex, childId, undefined, entrants.map((entrant, i) => ({
    seed: i + 1,
    poolCombo: entrant.name,
    combinedScore: 100 - i,
    members: [{ eventPlayerId: entrant.id, slot: 1 }],
  })), scores);
}

async function laneIds(ex: Executor, eventId: string): Promise<string[]> {
  return (await getLanesForEvent(ex, eventId)).map((lane) => lane.id).sort();
}

/** No lane is on two open matches, an occupied lane has exactly one, and a lent lane never holds a lender's match. */
async function expectSharedLaneInvariants(ex: Executor, parentId: string, childId: string): Promise<void> {
  const allLanes = await ex.select().from(lanes).where(eq(lanes.event_id, parentId));
  const loans = new Map((await ex.select().from(lane_loans).where(eq(lane_loans.from_event_id, parentId)))
    .map((loan) => [loan.lane_id, loan.to_event_id]));
  const matches = await ex.select().from(bracket_match).where(inArray(bracket_match.event_id, [parentId, childId]));
  for (const lane of allLanes) {
    const onLane = matches.filter((match) => match.lane_id === lane.id);
    const open = onLane.filter((match) => OPEN.has(match.status));
    expect({ lane: lane.label, open: open.length }).toEqual({ lane: lane.label, open: lane.status === 'occupied' ? 1 : 0 });
    expect(onLane.length).toBe(open.length);
    const user = loans.get(lane.id) ?? parentId;
    for (const match of onLane) expect({ lane: lane.label, event: match.event_id }).toEqual({ lane: lane.label, event: user });
  }
}

describe('lane loans', () => {
  it('moves an idle lane from the main event to its second chance and back', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { parent, childId } = await mainWithSecondChance(tx, 6);
      const before = await laneIds(tx, parent.eventId);
      const idle = (await getLanesForEvent(tx, parent.eventId)).filter((lane) => lane.status === 'idle').map((lane) => lane.id);
      expect(idle.length).toBeGreaterThanOrEqual(2);

      await lendLanes(parent.eventId, idle.slice(0, 2));
      expect(await laneIds(tx, childId)).toEqual(idle.slice(0, 2).sort());
      expect(await laneIds(tx, parent.eventId)).toEqual(before.filter((id) => !idle.slice(0, 2).includes(id)));
      expect(await getLaneLoans(parent.eventId)).toMatchObject({ role: 'main', partner_event_id: childId, can_lend: true });
      expect((await getLaneLoans(childId)).lanes).toHaveLength(2);

      await returnLanes(childId, [idle[0]]);
      expect(await laneIds(tx, childId)).toEqual([idle[1]]);
      await returnLanes(parent.eventId, [idle[1]]);
      expect(await laneIds(tx, parent.eventId)).toEqual(before);
    });
  });

  it('only lends idle lanes, once', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { parent, childId } = await mainWithSecondChance(tx, 2);
      const occupied = (await getLanesForEvent(tx, parent.eventId)).find((lane) => lane.status === 'occupied')!;
      await expect(lendLanes(parent.eventId, [occupied.id])).rejects.toMatchObject({ name: 'BadRequestError' });

      await tx.update(lanes).set({ status: 'maintenance' }).where(eq(lanes.id, occupied.id));
      await expect(lendLanes(parent.eventId, [occupied.id])).rejects.toMatchObject({ name: 'BadRequestError' });

      // The second chance can't lend, and can't add lanes of its own.
      await expect(lendLanes(childId, [occupied.id])).rejects.toMatchObject({ name: 'BadRequestError' });
      await expect(addLanes(childId, 1)).rejects.toMatchObject({ name: 'BadRequestError' });
    });
  });

  it('calls second-chance matches to lent lanes, and keeps a lane lent while its match is on it', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { parent, childId } = await mainWithSecondChance(tx, 4);
      await startSecondChance(tx, parent, childId);
      // Starting the second chance made no lanes of its own.
      expect(await laneIds(tx, childId)).toEqual([]);

      const idle = (await getLanesForEvent(tx, parent.eventId)).filter((lane) => lane.status === 'idle');
      await lendLanes(parent.eventId, [idle[0].id]);
      const childMatches = await getBracketSnapshot(tx, childId);
      const onLent = childMatches.matches.filter((match) => match.lane_id === idle[0].id);
      expect(onLent).toHaveLength(1);
      await expectSharedLaneInvariants(tx, parent.eventId, childId);

      await expect(returnLanes(parent.eventId, [idle[0].id])).rejects.toMatchObject({ name: 'BadRequestError' });

      // Main-event play never touches the lent lane.
      for (const match of playableMatches(await getBracketSnapshot(tx, parent.eventId))) {
        await playMatch(tx, parent.eventId, match.id, 'opponent1');
        await expectSharedLaneInvariants(tx, parent.eventId, childId);
      }
    });
  });

  it('gives every lent lane back when the second chance is completed, even with a match still on one', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { parent, childId } = await mainWithSecondChance(tx, 4);
      await startSecondChance(tx, parent, childId);
      const idle = (await getLanesForEvent(tx, parent.eventId)).filter((lane) => lane.status === 'idle');
      await lendLanes(parent.eventId, [idle[0].id]);
      const [onLoan] = await tx.select().from(lanes).where(eq(lanes.id, idle[0].id));
      expect(onLoan.status).toBe('occupied');

      await withTransaction(tx, (inner) => updateEventSettingsTx(inner, childId, { status: 'completed', force: true }));

      expect(await laneIds(tx, childId)).toEqual([]);
      const [lane] = await tx.select().from(lanes).where(eq(lanes.id, idle[0].id));
      expect(lane.event_id).toBe(parent.eventId);
      // Back in the main event's queue: idle, or already called to its next match.
      expect(['idle', 'occupied']).toContain(lane.status);
      await expectSharedLaneInvariants(tx, parent.eventId, childId);
    });
  });

  it('accepts duplicate lane ids in one request', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { parent, childId } = await mainWithSecondChance(tx, 6);
      const [lane] = (await getLanesForEvent(tx, parent.eventId)).filter((candidate) => candidate.status === 'idle');
      await lendLanes(parent.eventId, [lane.id, lane.id]);
      expect(await laneIds(tx, childId)).toEqual([lane.id]);
      await returnLanes(childId, [lane.id, lane.id]);
      expect(await laneIds(tx, childId)).toEqual([]);
    });
  });

  it('gives lent lanes back when the second chance is deleted', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { parent, childId } = await mainWithSecondChance(tx, 6);
      const idle = (await getLanesForEvent(tx, parent.eventId)).filter((lane) => lane.status === 'idle');
      await lendLanes(parent.eventId, [idle[0].id]);
      await deleteEvent(childId);
      expect(await laneIds(tx, parent.eventId)).toContain(idle[0].id);
      expect(await tx.select().from(lane_loans).where(eq(lane_loans.lane_id, idle[0].id))).toEqual([]);
    });
  });

  it('never reuses a lent lane label when the main event adds lanes', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { parent } = await mainWithSecondChance(tx, 3);
      const all = await getLanesForEvent(tx, parent.eventId);
      const highest = all.find((lane) => lane.label === 'Lane 3')!;
      if (highest.status !== 'idle') {
        await tx.update(bracket_match).set({ lane_id: null }).where(eq(bracket_match.lane_id, highest.id));
        await tx.update(lanes).set({ status: 'idle' }).where(eq(lanes.id, highest.id));
      }
      await lendLanes(parent.eventId, [highest.id]);
      const [added] = await addLanes(parent.eventId, 1);
      expect(added.label).toBe('Lane 4');
    });
  });
});

describe('lane loans under concurrent scoring (committed data)', () => {
  it('never double-books or strands a lane while both events score and lanes move', async () => {
    mockAuth.pg = db;
    const { parent, childId } = await mainWithSecondChance(db, 4);
    committed.push(parent);
    await startSecondChance(db, parent, childId);

    const succeeded = { play: 0, lend: 0, return: 0 };
    for (let round = 0; round < 6; round++) {
      const parentNext = playableMatches(await getBracketSnapshot(db, parent.eventId))[0];
      const childNext = playableMatches(await getBracketSnapshot(db, childId))[0];
      const parentIdle = (await getLanesForEvent(db, parent.eventId)).find((lane) => lane.status === 'idle');
      const borrowed = (await getLanesForEvent(db, childId)).find((lane) => lane.status === 'idle');

      const outcomes = await Promise.allSettled([
        parentNext ? playMatch(db, parent.eventId, parentNext.id, 'opponent1').then(() => 'play' as const) : null,
        childNext ? playMatch(db, childId, childNext.id, 'opponent1').then(() => 'play' as const) : null,
        parentIdle ? lendLanes(parent.eventId, [parentIdle.id]).then(() => 'lend' as const) : null,
        borrowed ? returnLanes(childId, [borrowed.id]).then(() => 'return' as const) : null,
      ]);
      for (const outcome of outcomes) {
        // A lane can change state between the read above and the call: only a client error is acceptable.
        if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ name: 'BadRequestError' });
        else if (outcome.value) succeeded[outcome.value]++;
      }
      await expectSharedLaneInvariants(db, parent.eventId, childId);
    }
    expect(succeeded.play).toBeGreaterThan(0);
    expect(succeeded.lend).toBeGreaterThan(0);
    expect(succeeded.return).toBeGreaterThan(0);

    // Whatever is left lent goes back on completion.
    await withTransaction(db, (tx) => updateEventSettingsTx(tx, childId, { status: 'completed', force: true }));
    expect(await db.select().from(lane_loans).where(and(eq(lane_loans.to_event_id, childId)))).toEqual([]);
    await expectSharedLaneInvariants(db, parent.eventId, childId);
  });
});
