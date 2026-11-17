/**
 * Second chance during the main event's bracket: entry by elimination, syncing later
 * knockouts in, the one-per-event rule, and what a match reset in the main event does.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { event_players, events, players } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/tx';
import { resetMatchResult } from '@/lib/services/bracket/bracket-service';
import { withTransaction } from '@/lib/db/tx';
import { createSecondChanceEvent, updateEventSettingsTx } from '@/lib/services/event/event-service';
import {
  getSecondChanceRoster,
  getSecondChanceSummary,
  syncSecondChancePlayers,
} from '@/lib/services/event/second-chance';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { playMatch, playOutBracket, playableMatches } from './db/play';
import { cleanupLeague, getBracketSnapshot, getParticipantPlayers, seedBracket, type SeededEvent } from './db/seed';

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

const accessCode = () => `sc${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const opponent1Wins = () => 'opponent1' as const;

/** Play every playable match in `groupNumber` (and only those) until none is left. */
async function playGroup(tx: Executor, eventId: string, groupNumber: number): Promise<void> {
  for (;;) {
    const next = playableMatches(await getBracketSnapshot(tx, eventId)).filter((match) => match.group_number === groupNumber);
    if (next.length === 0) return;
    await playMatch(tx, eventId, next[0].id, opponent1Wins());
  }
}

async function loserPlayerIds(tx: Executor, eventId: string, groupNumber: number): Promise<string[]> {
  const snapshot = await getBracketSnapshot(tx, eventId);
  const playerIds: string[] = [];
  for (const match of snapshot.matches.filter((candidate) => candidate.group_number === groupNumber)) {
    const loser = [match.opponent1, match.opponent2]
      .map((opponent) => opponent as { id?: number; result?: string } | null)
      .find((opponent) => opponent?.result === 'loss');
    if (loser?.id == null) continue;
    const eventPlayerIds = await getParticipantPlayers(tx, eventId, loser.id);
    const rows = await tx.select({ player_id: event_players.player_id, id: event_players.id }).from(event_players)
      .where(eq(event_players.event_id, eventId));
    playerIds.push(...rows.filter((row) => eventPlayerIds.includes(row.id)).map((row) => row.player_id));
  }
  return playerIds.sort();
}

async function entrantIds(tx: Executor, eventId: string): Promise<string[]> {
  const rows = await tx.select({ player_id: event_players.player_id }).from(event_players)
    .where(eq(event_players.event_id, eventId));
  return rows.map((row) => row.player_id).sort();
}

describe('second chance during bracket play', () => {
  it('starts empty while nobody is out, as single elimination', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await seedBracket(tx, { teams: 4 });

      expect(await getSecondChanceSummary(parent.eventId)).toMatchObject({
        status: 'bracket', eliminated_count: 0, child: null, can_create: true,
      });
      const child = await createSecondChanceEvent(parent.eventId, { access_code: accessCode() });
      expect(child).toMatchObject({
        status: 'created',
        team_size: 1,
        bracket_format: 'single_elimination',
        double_grand_final: false,
        third_place_match: false,
      });
      expect(await entrantIds(tx, child.id)).toEqual([]);
      expect(await getSecondChanceSummary(parent.eventId)).toMatchObject({
        child: { id: child.id, status: 'created' }, can_create: false,
      });
    });
  });

  it('enters losers-bracket losers only: a winners-bracket loss is not elimination', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await seedBracket(tx, { teams: 4, laneCount: 2 });
      await playGroup(tx, parent.eventId, 1);
      expect((await getSecondChanceSummary(parent.eventId)).eliminated_count).toBe(0);

      await playGroup(tx, parent.eventId, 2);
      const knockedOut = await loserPlayerIds(tx, parent.eventId, 2);
      expect(knockedOut.length).toBeGreaterThan(0);
      expect((await getSecondChanceSummary(parent.eventId)).eliminated_count).toBe(knockedOut.length);

      const child = await createSecondChanceEvent(parent.eventId, { access_code: accessCode(), bracket_format: 'double_elimination' });
      expect(child.bracket_format).toBe('double_elimination');
      expect(child.double_grand_final).toBe(true);
      expect(await entrantIds(tx, child.id)).toEqual(knockedOut);
    });
  });

  it('adds later knockouts on sync, and only before the second-chance bracket starts', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await seedBracket(tx, { teams: 8, laneCount: 4, bracketFormat: 'single_elimination' });
      const child = await createSecondChanceEvent(parent.eventId, { access_code: accessCode() });

      // Quarterfinals: four players' teams (doubles) are out.
      const firstRound = playableMatches(await getBracketSnapshot(tx, parent.eventId)).filter((m) => m.round_number === 1);
      for (const match of firstRound) await playMatch(tx, parent.eventId, match.id, 'opponent1');

      const before = await getSecondChanceRoster(child.id);
      expect(before.pending).toHaveLength(8);
      expect(before.can_sync).toBe(true);

      const synced = await syncSecondChancePlayers(child.id);
      expect(synced.added).toBe(8);
      expect(synced.pending).toEqual([]);
      expect(await entrantIds(tx, child.id)).toEqual(await loserPlayerIds(tx, parent.eventId, 1));

      // Idempotent: nothing new to add.
      expect((await syncSecondChancePlayers(child.id)).added).toBe(0);

      await tx.update(events).set({ status: 'bracket' }).where(eq(events.id, child.id));
      await expect(syncSecondChancePlayers(child.id)).rejects.toMatchObject({ name: 'BadRequestError' });
      expect((await getSecondChanceRoster(child.id)).can_sync).toBe(false);
    });
  });

  it('flags, but never removes, an entrant whose knockout was reset in the main event', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await seedBracket(tx, { teams: 4, bracketFormat: 'single_elimination' });
      const semi = playableMatches(await getBracketSnapshot(tx, parent.eventId))[0];
      await playMatch(tx, parent.eventId, semi.id, 'opponent1');
      const child = await createSecondChanceEvent(parent.eventId, { access_code: accessCode() });
      const entered = await entrantIds(tx, child.id);
      expect(entered).toHaveLength(2);

      await resetMatchResult(parent.eventId, semi.id);

      const roster = await getSecondChanceRoster(child.id);
      expect(roster.not_eliminated.map((player) => player.player_id).sort()).toEqual(entered);
      expect((await syncSecondChancePlayers(child.id)).added).toBe(0);
      expect(await entrantIds(tx, child.id)).toEqual(entered);
    });
  });

  it('does not flag an entrant who never played in the main event', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await seedBracket(tx, { teams: 4 });
      const child = await createSecondChanceEvent(parent.eventId, { access_code: accessCode() });
      const [walkIn] = await tx.insert(players).values({ full_name: `Walk-in ${randomUUID()}` }).returning({ id: players.id });
      await tx.insert(event_players).values({ event_id: child.id, player_id: walkIn.id, putt_distance_ft: '25' });

      expect((await getSecondChanceRoster(child.id)).not_eliminated).toEqual([]);
    });
  });

  it('enters everyone but the winners of a completed event, and syncing adds nobody', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await seedBracket(tx, { teams: 4, laneCount: 2, bracketFormat: 'single_elimination' });
      await playOutBracket(tx, parent.eventId, opponent1Wins);
      await withTransaction(tx, (inner) => updateEventSettingsTx(inner, parent.eventId, { status: 'completed' }));

      const child = await createSecondChanceEvent(parent.eventId, { access_code: accessCode() });
      const entered = await entrantIds(tx, child.id);
      // Doubles, four teams: everyone but the winning pair.
      expect(entered).toHaveLength(6);

      const roster = await getSecondChanceRoster(child.id);
      expect(roster.pending).toEqual([]);
      expect((await syncSecondChancePlayers(child.id)).added).toBe(0);
      expect(await entrantIds(tx, child.id)).toEqual(entered);
      expect((await getSecondChanceSummary(parent.eventId)).eliminated_count).toBe(6);
    });
  });

  it('refuses to sync an event that is not a second chance', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const parent = await seedBracket(tx, { teams: 2 });
      await expect(syncSecondChancePlayers(parent.eventId)).rejects.toMatchObject({ name: 'BadRequestError' });
    });
  });

  it('allows one second chance per event, even for concurrent requests', async () => {
    mockAuth.pg = db;
    const parent = await seedBracket(db, { teams: 2 });
    committed.push(parent);
    const outcomes = await Promise.allSettled([
      createSecondChanceEvent(parent.eventId, { access_code: accessCode() }),
      createSecondChanceEvent(parent.eventId, { access_code: accessCode() }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { name: 'ConflictError' },
    });
    await expect(createSecondChanceEvent(parent.eventId, { access_code: accessCode() }))
      .rejects.toMatchObject({ name: 'ConflictError' });
  });
});
