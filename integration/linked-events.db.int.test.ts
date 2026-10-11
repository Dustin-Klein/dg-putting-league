/**
 * Linked events (plan 07, Decision 2): second-chance creation from a completed doubles
 * event, the one-level-deep rule, the parent deletion guard, and cross-event locking.
 */
import { randomUUID } from 'node:crypto';
import { and, count, eq, inArray, sum } from 'drizzle-orm';
import { event_placements, event_players, events, frame_results, team_members, teams } from '@/lib/db/schema';
import { lockEvents, withTransaction, type Executor } from '@/lib/db/tx';
import * as eventDb from '@/lib/repositories/event-repository.db';
import {
  createSecondChanceEvent,
  deleteEvent,
  updateEventSettings,
  updateEventSettingsTx,
  validateEventStatusTransition,
} from '@/lib/services/event/event-service';
import type { EventWithDetails } from '@/lib/types/event';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { playOutBracket } from './db/play';
import { cleanupLeague, seedBracket, seedEvent, type SeededEvent } from './db/seed';

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

const db = createTestDb(20);
const committed: SeededEvent[] = [];
afterAll(async () => {
  for (const event of committed) {
    await cleanupLeague(db, event);
  }
  await closeDb(db);
});

function accessCode(): string {
  return `sc${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** A 4-team doubles event played to completion through the real services. */
async function completedDoublesEvent(tx: Executor): Promise<SeededEvent> {
  const event = await seedBracket(tx, { teams: 4, laneCount: 2 });
  await playOutBracket(tx, event.eventId, () => 'opponent1');
  await withTransaction(tx, (inner) => updateEventSettingsTx(inner, event.eventId, { status: 'completed' }));
  return event;
}

async function winningPlayerIds(tx: Executor, eventId: string): Promise<string[]> {
  const rows = await tx
    .select({ player_id: event_players.player_id })
    .from(event_placements)
    .innerJoin(team_members, eq(team_members.team_id, event_placements.team_id))
    .innerJoin(event_players, eq(event_players.id, team_members.event_player_id))
    .where(and(eq(event_placements.event_id, eventId), eq(event_placements.placement, 1)));
  return rows.map((row) => row.player_id);
}

async function entrantsOf(tx: Executor, eventId: string) {
  return tx.select().from(event_players).where(eq(event_players.event_id, eventId));
}

describe('createSecondChanceEvent', () => {
  it('enters every player except the winning team, per player, as a singles event', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await completedDoublesEvent(tx);
      const winners = await winningPlayerIds(tx, parent.eventId);
      expect(winners).toHaveLength(2);

      const child = await createSecondChanceEvent(parent.eventId, { access_code: accessCode() });

      expect(child).toMatchObject({
        league_id: parent.leagueId,
        parent_event_id: parent.eventId,
        link_type: 'second_chance',
        status: 'created',
        team_size: 1,
        qualification_round_enabled: false,
        lane_count: 2,
      });
      const entrants = await entrantsOf(tx, child.id);
      expect(entrants.map((e) => e.player_id).sort())
        .toEqual(parent.playerIds.filter((id) => !winners.includes(id)).sort());
      expect(entrants).toHaveLength(6);
      // Its own access code
      expect(await eventDb.getEventAccessCode(tx, child.id)).not.toBe(await eventDb.getEventAccessCode(tx, parent.eventId));
    });
  });

  it('copies player_id only: payment_type NULL, no pool or seed, pfa_score computed fresh', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await completedDoublesEvent(tx);
      await tx.update(event_players).set({ qualification_seed: 1 }).where(eq(event_players.event_id, parent.eventId));
      const parentEntries = new Map((await entrantsOf(tx, parent.eventId)).map((e) => [e.player_id, e]));
      // Everyone paid the parent's entry fee and has the parent's seeding score.
      for (const entry of parentEntries.values()) {
        expect(entry.payment_type).toBe('cash');
        expect(entry.pool).not.toBeNull();
      }

      const child = await createSecondChanceEvent(parent.eventId, {
        access_code: accessCode(),
        exclude_top_placements: 2,
      });

      const entrants = await entrantsOf(tx, child.id);
      expect(entrants.length).toBeGreaterThan(0);
      const expectedPfa = new Map(
        (await tx
          .select({ player_id: event_players.player_id, total: sum(frame_results.points_earned), frames: count(frame_results.id) })
          .from(frame_results)
          .innerJoin(event_players, eq(event_players.id, frame_results.event_player_id))
          .where(inArray(event_players.player_id, entrants.map((e) => e.player_id)))
          .groupBy(event_players.player_id)
        ).map((row) => [row.player_id, Math.round((Number(row.total) / Number(row.frames)) * 100) / 100])
      );

      for (const entrant of entrants) {
        expect(entrant.payment_type).toBeNull();
        expect(entrant.pool).toBeNull();
        expect(entrant.qualification_seed).toBeNull();
        expect(entrant.scoring_method).toBe('pfa');
        // From the PFA window, which now includes the parent's frames — not the parent's stored score.
        expect(Number(entrant.pfa_score)).toBe(expectedPfa.get(entrant.player_id));
        expect(entrant.pfa_score).not.toBe(parentEntries.get(entrant.player_id)!.pfa_score);
      }

      // The regression the copy rule prevents: the second entry fee is still owed.
      await updateEventSettings(child.id, { status: 'pre-bracket' });
      const childEvent = await eventDb.getEventWithPlayers(tx, child.id, { includePaymentType: true }) as EventWithDetails;
      await expect(validateEventStatusTransition(child.id, 'bracket', childEvent, tx))
        .rejects.toThrow('All players must be marked as paid before starting bracket play');
    });
  });

  it('refuses a grandchild: a linked event cannot itself be a parent', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await completedDoublesEvent(tx);
      const child = await createSecondChanceEvent(parent.eventId, { access_code: accessCode() });
      // Even a completed child with placements may not be linked to.
      await tx.update(events).set({ status: 'completed' }).where(eq(events.id, child.id));
      const [team] = await tx.insert(teams).values({ event_id: child.id, seed: 1 }).returning({ id: teams.id });
      await tx.insert(event_placements).values({ event_id: child.id, team_id: team.id, placement: 2 });

      await expect(createSecondChanceEvent(child.id, { access_code: accessCode() }))
        .rejects.toThrow('A linked event cannot have linked events of its own');
      const grandchildren = await tx.select({ id: events.id }).from(events).where(eq(events.parent_event_id, child.id));
      expect(grandchildren).toEqual([]);
    });
  });

  it('refuses a parent that is not completed, and a cut that leaves nobody', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const running = await seedBracket(tx, { teams: 4 });
      await expect(createSecondChanceEvent(running.eventId, { access_code: accessCode() }))
        .rejects.toThrow('A second-chance event can only be created from a completed event');

      const parent = await completedDoublesEvent(tx);
      await expect(createSecondChanceEvent(parent.eventId, { access_code: accessCode(), exclude_top_placements: 99 }))
        .rejects.toThrow('No players are eligible for a second-chance event');
    });
  });
});

describe('deleteEvent with a linked event', () => {
  it('is blocked while the linked event is live, and deletes nothing', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await completedDoublesEvent(tx);
      const child = await createSecondChanceEvent(parent.eventId, { access_code: accessCode() });
      await updateEventSettings(child.id, { status: 'pre-bracket' });

      await expect(deleteEvent(parent.eventId)).rejects.toMatchObject({
        name: 'ConflictError',
        message: expect.stringContaining('has already started'),
      });
      const remaining = await tx.select({ id: events.id }).from(events)
        .where(inArray(events.id, [parent.eventId, child.id]));
      expect(remaining).toHaveLength(2);

      // Deleting the linked event first unblocks the parent.
      await deleteEvent(child.id);
      await deleteEvent(parent.eventId);
      expect(await eventDb.getEventById(tx, parent.eventId)).toBeNull();
    });
  });

  it('takes a linked event still in created status with it', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await completedDoublesEvent(tx);
      const child = await createSecondChanceEvent(parent.eventId, { access_code: accessCode() });

      await deleteEvent(parent.eventId);
      const remaining = await tx.select({ id: events.id }).from(events)
        .where(inArray(events.id, [parent.eventId, child.id]));
      expect(remaining).toEqual([]);
    });
  });
});

describe('cross-event locking (committed data, real concurrency)', () => {
  const ITERATIONS = 20;

  it('rejects a concurrent duplicate access code as a client error without leaving a partial child', async () => {
    mockAuth.pg = db;
    const parent = await seedBracket(db, { teams: 2 });
    committed.push(parent);
    const parentTeams = await db.select({ id: teams.id, seed: teams.seed }).from(teams)
      .where(eq(teams.event_id, parent.eventId));
    await db.insert(event_placements).values(parentTeams.map((team) => ({
      event_id: parent.eventId, team_id: team.id, placement: team.seed!,
    })));
    await db.update(events).set({ status: 'completed' }).where(eq(events.id, parent.eventId));

    // Force both requests to pass their preflight check before either inserts.
    const checkUnique = eventDb.isAccessCodeUnique;
    let checked = 0;
    let release!: () => void;
    const bothChecked = new Promise<void>((resolve) => { release = resolve; });
    const check = jest.spyOn(eventDb, 'isAccessCodeUnique').mockImplementation(async (...args) => {
      const unique = await checkUnique(...args);
      if (++checked === 2) release();
      await bothChecked;
      return unique;
    });
    try {
      const input = { access_code: accessCode() };
      const outcomes = await Promise.allSettled([
        createSecondChanceEvent(parent.eventId, input),
        createSecondChanceEvent(parent.eventId, input),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
        status: 'rejected',
        reason: { name: 'BadRequestError', message: 'An event with this access code already exists' },
      });
      const children = await eventDb.getChildEvents(db, parent.eventId);
      expect(children).toHaveLength(1);
      expect(await entrantsOf(db, children[0].id)).toHaveLength(2);
    } finally {
      check.mockRestore();
    }
  });

  it(`locks two events in ascending id order whichever order callers name them (${ITERATIONS}x)`, async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const a = randomUUID();
      const b = randomUUID();
      const hold = (ids: string[]) => withTransaction(db, async (tx) => {
        await lockEvents(tx, ids);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      // Opposite orders would deadlock if locks were taken as named.
      await expect(Promise.all([hold([a, b]), hold([b, a])])).resolves.toBeDefined();
    }
  });

  async function committedParentWithChild(): Promise<{ parent: SeededEvent; childId: string }> {
    const parent = await seedEvent(db, { players: 2, status: 'completed' });
    committed.push(parent);
    const child = await eventDb.createEvent(db, {
      league_id: parent.leagueId,
      parent_event_id: parent.eventId,
      link_type: 'second_chance',
      event_date: '2026-10-08',
      location: null,
      lane_count: 1,
      putt_distance_ft: 25,
      access_code: accessCode(),
      qualification_round_enabled: false,
      bracket_frame_count: 5,
      qualification_frame_count: 5,
      team_size: 1,
      status: 'created',
    });
    return { parent, childId: child.id };
  }

  it(`parent delete vs. child status change: never deadlocks, never deletes a started child (${ITERATIONS}x)`, async () => {
    mockAuth.pg = db;
    for (let i = 0; i < ITERATIONS; i++) {
      const { parent, childId } = await committedParentWithChild();
      const [deleted, started] = await Promise.allSettled([
        deleteEvent(parent.eventId),
        updateEventSettings(childId, { status: 'pre-bracket' }),
      ]);

      const rows = await db.select({ id: events.id, status: events.status }).from(events)
        .where(inArray(events.id, [parent.eventId, childId]));
      if (deleted.status === 'fulfilled') {
        // The delete won: both gone, and the status change found nothing.
        expect(rows).toEqual([]);
        expect(started).toMatchObject({ status: 'rejected', reason: { name: 'NotFoundError' } });
      } else {
        // The status change won: the delete was refused, both survive.
        expect(deleted.reason).toMatchObject({ name: 'ConflictError' });
        expect(started.status).toBe('fulfilled');
        expect(rows.find((row) => row.id === childId)?.status).toBe('pre-bracket');
        expect(rows).toHaveLength(2);
      }
    }
  });

  it(`second-chance creation vs. parent delete: never deadlocks, never orphans (${ITERATIONS}x)`, async () => {
    mockAuth.pg = db;
    for (let i = 0; i < ITERATIONS; i++) {
      const parent = await seedBracket(db, { teams: 2 });
      committed.push(parent);
      const parentTeams = await db.select({ id: teams.id, seed: teams.seed }).from(teams)
        .where(eq(teams.event_id, parent.eventId));
      await db.insert(event_placements).values(
        parentTeams.map((team) => ({ event_id: parent.eventId, team_id: team.id, placement: team.seed! }))
      );
      await db.update(events).set({ status: 'completed' }).where(eq(events.id, parent.eventId));

      const [created, deleted] = await Promise.allSettled([
        createSecondChanceEvent(parent.eventId, { access_code: accessCode() }),
        deleteEvent(parent.eventId),
      ]);

      for (const outcome of [created, deleted]) {
        if (outcome.status === 'rejected') {
          expect(['NotFoundError', 'ConflictError']).toContain(outcome.reason?.name);
        }
      }
      const parentRow = await eventDb.getEventById(db, parent.eventId);
      if (created.status === 'fulfilled') {
        const childRow = await eventDb.getEventById(db, created.value.id);
        // Either both remain (delete refused) or both are gone (child was still 'created').
        expect(Boolean(childRow)).toBe(Boolean(parentRow));
      }
      if (deleted.status === 'fulfilled') {
        expect(parentRow).toBeNull();
      }
    }
  });
});
