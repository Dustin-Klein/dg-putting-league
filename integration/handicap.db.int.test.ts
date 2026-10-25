/**
 * Distance handicaps (plan 06) against real Postgres: entry snapshots and the first-putt
 * freeze, evaluation at event completion, the demotion review queue, admin changes,
 * completed-event immutability, and concurrent completions in one league.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  bracket_match,
  event_players,
  event_zone_distances,
  events,
  frame_results,
  league_admins,
  league_handicap_settings,
  league_handicap_zones,
  players,
  player_zone_evaluations,
  player_zone_periods,
  qualification_frames,
  qualification_rounds,
} from '@/lib/db/schema';
import { withTransaction, type Executor } from '@/lib/db/tx';
import {
  createEvent,
  createSecondChanceEvent,
  deleteEvent,
  startBracket,
  updateEventSettingsTx,
} from '@/lib/services/event/event-service';
import { evaluateEventHandicaps } from '@/lib/services/handicap/evaluate';
import { refreshEntrySnapshots } from '@/lib/services/handicap/snapshot';
import {
  getEventHandicap,
  updateEntryHandicap,
  updateEventZoneDistances,
  updateHandicapSettings,
} from '@/lib/services/handicap/settings-service';
import { lockQualificationEvent } from '@/lib/repositories/qualification-repository.db';
import { getPlayerHandicap, resolveZoneSuggestion, setPlayerZone } from '@/lib/services/handicap/zone-service';
import { BadRequestError, ConflictError } from '@/lib/errors';
import { DEFAULT_HANDICAP_SETTINGS, type HandicapSettings } from '@/lib/types/handicap';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { playOutBracket } from './db/play';
import { buildDeterministicPairings, cleanupLeague, seedLeague, type SeededEvent } from './db/seed';
import { testUsers } from './db/users';

const mockAuth: { pg?: Executor; userId?: string; viewer?: { id: string } | null } = {};
jest.mock('@/lib/services/auth', () => ({
  authorizeEventAdmin: async () => ({ user: { id: mockAuth.userId }, event: {}, pg: mockAuth.pg }),
  authorizeLeagueAdmin: async () => ({ user: { id: mockAuth.userId }, pg: mockAuth.pg }),
  authorizeEventView: async (eventId: string) => ({
    user: { id: mockAuth.userId }, event: { id: eventId }, isAdmin: true, pg: mockAuth.pg,
  }),
  authorizePublicRead: () => ({ pg: mockAuth.pg }),
  getViewer: async () => mockAuth.viewer ?? null,
}));

const db = createTestDb(20);
const users = testUsers();
const committed: Array<{ leagueId: string; playerIds?: string[] }> = [];
let adminId: string;

beforeAll(async () => {
  adminId = (await users.create()).id;
  mockAuth.userId = adminId;
});

afterAll(async () => {
  for (const seed of committed) await cleanupLeague(db, seed);
  await users.cleanup();
  await closeDb(db);
});

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/** Settings for tests: one live criterion, small enough that one event decides. */
const TEST_SETTINGS: HandicapSettings = {
  ...DEFAULT_HANDICAP_SETTINGS,
  enabled: true,
  min_putts: 15,
  min_matches: 0,
  window_putts: null,
};

async function enableHandicaps(ex: Executor, leagueId: string, settings: Partial<HandicapSettings> = {}) {
  const s = { ...TEST_SETTINGS, ...settings };
  await ex.insert(league_handicap_settings).values({
    league_id: leagueId,
    enabled: s.enabled,
    default_zone: s.default_zone,
    demote_below_pct: String(s.demote_below_pct),
    promote_above_pct: String(s.promote_above_pct),
    min_putts: s.min_putts,
    min_matches: s.min_matches,
    window_putts: s.window_putts,
    count_qualification_putts: s.count_qualification_putts,
    auto_demote_enabled: s.auto_demote_enabled,
  });
  await ex.insert(league_handicap_zones).values([
    { league_id: leagueId, zone: 1, distance_ft: '21' },
    { league_id: leagueId, zone: 2, distance_ft: '27' },
    { league_id: leagueId, zone: 3, distance_ft: '33' },
  ]);
}

async function setSettings(ex: Executor, leagueId: string, patch: Partial<typeof league_handicap_settings.$inferInsert>) {
  await ex.update(league_handicap_settings).set(patch).where(eq(league_handicap_settings.league_id, leagueId));
}

async function newPlayers(ex: Executor, count: number): Promise<string[]> {
  const suffix = randomUUID().slice(0, 8);
  const rows = await ex.insert(players)
    .values(Array.from({ length: count }, (_, i) => ({ full_name: `H${i + 1} ${suffix}` })))
    .returning({ id: players.id });
  return rows.map((row) => row.id);
}

/**
 * A handicap event entering `playerIds` (paid), snapshotted like the real flows do.
 * Distances default to the league ladder.
 */
async function handicapEvent(
  ex: Executor,
  leagueId: string,
  playerIds: string[],
  opts: { status?: 'created' | 'pre-bracket'; distances?: [number, number, number]; handicap?: boolean } = {}
): Promise<SeededEvent> {
  const [event] = await ex.insert(events).values({
    league_id: leagueId,
    event_date: '2026-10-08',
    location: 'Handicap test',
    lane_count: 2,
    putt_distance_ft: '15',
    access_code: `hc${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    status: opts.status ?? 'pre-bracket',
    double_grand_final: false,
    handicap_enabled: opts.handicap ?? true,
    entry_fee_per_player: null,
    admin_fees: null,
    admin_fee_per_player: null,
    payout_pool_override: null,
  }).returning({ id: events.id });
  if (opts.handicap ?? true) {
    const [d1, d2, d3] = opts.distances ?? [21, 27, 33];
    await ex.insert(event_zone_distances).values([
      { event_id: event.id, zone: 1, distance_ft: String(d1) },
      { event_id: event.id, zone: 2, distance_ft: String(d2) },
      { event_id: event.id, zone: 3, distance_ft: String(d3) },
    ]);
  }
  const entries = playerIds.length === 0 ? [] : await ex.insert(event_players)
    .values(playerIds.map((player_id) => ({ event_id: event.id, player_id, payment_type: 'cash', putt_distance_ft: '15' })))
    .returning({ id: event_players.id, player_id: event_players.player_id });
  await withTransaction(ex, (tx) => refreshEntrySnapshots(tx, event.id));
  const names = playerIds.length === 0 ? [] : await ex.select({ id: players.id, name: players.full_name }).from(players)
    .where(inArray(players.id, playerIds));
  const byPlayer = new Map(entries.map((entry) => [entry.player_id, entry.id]));
  const nameById = new Map(names.map((row) => [row.id, row.name]));
  return {
    leagueId,
    eventId: event.id,
    accessCode: '',
    eventPlayerIds: playerIds.map((id) => byPlayer.get(id)!),
    playerIds,
    playerNames: playerIds.map((id) => nameById.get(id)!),
  };
}

/** Start the bracket and play it out (opponent 1 always wins: one undefeated team, one 0-2). */
async function playEvent(ex: Executor, event: SeededEvent): Promise<void> {
  const { poolAssignments, teamPairings } = buildDeterministicPairings(event);
  await startBracket(ex, event.eventId, poolAssignments, teamPairings);
  await playOutBracket(ex, event.eventId, () => 'opponent1');
}

async function complete(ex: Executor, eventId: string) {
  return withTransaction(ex, (tx) => updateEventSettingsTx(tx, eventId, { status: 'completed' }));
}

async function entryOf(ex: Executor, eventId: string, playerId: string) {
  const [row] = await ex.select().from(event_players)
    .where(and(eq(event_players.event_id, eventId), eq(event_players.player_id, playerId)));
  return row;
}

async function openPeriod(ex: Executor, leagueId: string, playerId: string) {
  const [row] = await ex.select().from(player_zone_periods).where(and(
    eq(player_zone_periods.league_id, leagueId),
    eq(player_zone_periods.player_id, playerId),
    isNull(player_zone_periods.ended_at)
  ));
  return row;
}

async function evaluationsOf(ex: Executor, eventId: string) {
  return ex.select().from(player_zone_evaluations).where(eq(player_zone_evaluations.event_id, eventId));
}

async function openSuggestions(ex: Executor, leagueId: string) {
  return ex.select().from(player_zone_evaluations).where(and(
    eq(player_zone_evaluations.league_id, leagueId),
    eq(player_zone_evaluations.decision, 'demote'),
    eq(player_zone_evaluations.applied, false),
    isNull(player_zone_evaluations.resolution)
  ));
}

async function addQualificationFrame(ex: Executor, eventId: string, eventPlayerId: string, puttsMade = 2) {
  let [round] = await ex.select().from(qualification_rounds).where(eq(qualification_rounds.event_id, eventId));
  if (!round) {
    [round] = await ex.insert(qualification_rounds).values({ event_id: eventId, frame_count: 5 }).returning();
  }
  await ex.insert(qualification_frames).values({
    qualification_round_id: round.id,
    event_id: eventId,
    event_player_id: eventPlayerId,
    frame_number: 1,
    putts_made: puttsMade,
    points_earned: puttsMade,
  });
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

describe('entry snapshots', () => {
  it('opens an initial period at the starting zone and putts from the event distance for that zone', async () => {
    await withRollback(db, async (tx) => {
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const [playerId] = await newPlayers(tx, 1);
      const event = await handicapEvent(tx, leagueId, [playerId], { distances: [20, 26, 32] });

      const period = await openPeriod(tx, leagueId, playerId);
      expect(period).toMatchObject({ zone: 2, distance_ft: '27.00', start_reason: 'initial' });
      expect(await entryOf(tx, event.eventId, playerId)).toMatchObject({
        zone: 2, putt_distance_ft: '26.00', zone_period_id: period.id,
      });
    });
  });

  it('gives an event without handicaps the event distance and no zone', async () => {
    await withRollback(db, async (tx) => {
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const [playerId] = await newPlayers(tx, 1);
      const event = await handicapEvent(tx, leagueId, [playerId], { handicap: false });
      expect(await entryOf(tx, event.eventId, playerId)).toMatchObject({
        zone: null, zone_period_id: null, putt_distance_ft: '15.00',
      });
      expect(await openPeriod(tx, leagueId, playerId)).toBeUndefined();
    });
  });

  it('refreshes at created → pre-bracket a player whose zone changed after the roster was copied', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const [playerId] = await newPlayers(tx, 1);
      const event = await handicapEvent(tx, leagueId, [playerId], { status: 'created' });

      await setPlayerZone(leagueId, playerId, 3, 'Too good for Zone 2');
      await withTransaction(tx, (inner) => updateEventSettingsTx(inner, event.eventId, { status: 'pre-bracket' }));

      const period = await openPeriod(tx, leagueId, playerId);
      expect(period).toMatchObject({ zone: 3, start_reason: 'manual', started_by_user: adminId });
      expect(await entryOf(tx, event.eventId, playerId)).toMatchObject({
        zone: 3, putt_distance_ft: '33.00', zone_period_id: period.id,
      });
    });
  });

  it('freezes an entry from its first putt: a promotion after qualification is not applied at bracket start', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const playerIds = await newPlayers(tx, 8);
      const event = await handicapEvent(tx, leagueId, playerIds);
      const before = await entryOf(tx, event.eventId, playerIds[0]);
      expect(before).toMatchObject({ zone: 2, putt_distance_ft: '27.00' });

      await addQualificationFrame(tx, event.eventId, before.id);
      await setPlayerZone(leagueId, playerIds[0], 3, 'Promoted mid-qualification');
      await setPlayerZone(leagueId, playerIds[1], 3, 'Promoted before their first putt');
      await expect(updateEntryHandicap(event.eventId, before.id, { putt_distance_ft: 25 }))
        .rejects.toThrow(ConflictError);

      const { poolAssignments, teamPairings } = buildDeterministicPairings(event);
      await startBracket(tx, event.eventId, poolAssignments, teamPairings);

      expect(await entryOf(tx, event.eventId, playerIds[0])).toMatchObject({
        zone: 2, putt_distance_ft: '27.00', zone_period_id: before.zone_period_id,
      });
      // An entry without frames does pick up a change at bracket start.
      expect(await entryOf(tx, event.eventId, playerIds[1])).toMatchObject({ zone: 3, putt_distance_ft: '33.00' });
    });
  });

  it('keeps a hand-set distance through a refresh, and the putts still count toward the zone', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const [playerId] = await newPlayers(tx, 1);
      const event = await handicapEvent(tx, leagueId, [playerId]);
      const entry = await entryOf(tx, event.eventId, playerId);

      await updateEntryHandicap(event.eventId, entry.id, { putt_distance_ft: 25 });
      await withTransaction(tx, (inner) => refreshEntrySnapshots(inner, event.eventId));
      expect(await entryOf(tx, event.eventId, playerId)).toMatchObject({
        zone: 2, putt_distance_ft: '25.00', distance_override: true, exclude_from_handicap: false,
      });

      await updateEntryHandicap(event.eventId, entry.id, { putt_distance_ft: null });
      expect(await entryOf(tx, event.eventId, playerId)).toMatchObject({ putt_distance_ft: '27.00', distance_override: false });
    });
  });
});

describe('event zone distances', () => {
  it('are seeded from the ladder at creation, editable before the first frame and fixed after', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const source = await handicapEvent(tx, leagueId, await newPlayers(tx, 2));

      const created = await createEvent({
        league_id: leagueId,
        event_date: '2026-10-15',
        location: null,
        lane_count: 2,
        putt_distance_ft: 15,
        access_code: `hc${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        qualification_round_enabled: false,
        bracket_frame_count: 5,
        qualification_frame_count: 5,
        copy_players_from_event_id: source.eventId,
      });
      expect(created.handicap_enabled).toBe(true);
      const seeded = await tx.select().from(event_zone_distances).where(eq(event_zone_distances.event_id, created.id));
      expect(seeded.map((z) => [z.zone, z.distance_ft]).sort()).toEqual([[1, '21.00'], [2, '27.00'], [3, '33.00']]);
      expect(await entryOf(tx, created.id, source.playerIds[0])).toMatchObject({ zone: 2, putt_distance_ft: '27.00' });

      await expect(updateEventZoneDistances(created.id, [
        { zone: 1, distance_ft: 21 }, { zone: 2, distance_ft: 22 }, { zone: 3, distance_ft: 33 },
      ])).rejects.toThrow(BadRequestError);

      const view = await updateEventZoneDistances(created.id, [
        { zone: 1, distance_ft: 19 }, { zone: 2, distance_ft: 25 }, { zone: 3, distance_ft: 31 },
      ]);
      expect(view.zones.find((z) => z.zone === 2)).toMatchObject({ distance_ft: 25, league_distance_ft: 27 });
      expect(await entryOf(tx, created.id, source.playerIds[0])).toMatchObject({ putt_distance_ft: '25.00' });

      await tx.update(events).set({ status: 'pre-bracket' }).where(eq(events.id, created.id));
      const entry = await entryOf(tx, created.id, source.playerIds[0]);
      await addQualificationFrame(tx, created.id, entry.id);
      await expect(updateEventZoneDistances(created.id, [
        { zone: 1, distance_ft: 21 }, { zone: 2, distance_ft: 27 }, { zone: 3, distance_ft: 33 },
      ])).rejects.toThrow(ConflictError);
    });
  });

  it('follow ladder changes made after the event was created, until the first frame', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const event = await handicapEvent(tx, leagueId, await newPlayers(tx, 2), { distances: [20, 26, 32] });

      await updateHandicapSettings(leagueId, {
        settings: TEST_SETTINGS,
        zones: [{ zone: 1, distance_ft: 21 }, { zone: 2, distance_ft: 27 }, { zone: 3, distance_ft: 33 }, { zone: 4, distance_ft: 39 }],
      });
      const grown = await getEventHandicap(event.eventId);
      expect(grown.zones.map((z) => [z.zone, z.distance_ft])).toEqual([[1, 20], [2, 26], [3, 32], [4, 39]]);
      await updateEventZoneDistances(event.eventId, grown.zones.map(({ zone, distance_ft }) => ({ zone, distance_ft })));

      await updateHandicapSettings(leagueId, {
        settings: TEST_SETTINGS,
        zones: [{ zone: 1, distance_ft: 21 }, { zone: 2, distance_ft: 27 }, { zone: 3, distance_ft: 33 }],
      });
      const shrunk = await getEventHandicap(event.eventId);
      expect(shrunk.zones.map((z) => [z.zone, z.distance_ft])).toEqual([[1, 20], [2, 26], [3, 32]]);
      const saved = await updateEventZoneDistances(event.eventId, shrunk.zones.map(({ zone, distance_ft }) => ({ zone, distance_ft })));
      expect(saved.zones.map((z) => z.zone)).toEqual([1, 2, 3]);

      // Once fixed, the view is what the event used, whatever the ladder says now.
      await addQualificationFrame(tx, event.eventId, event.eventPlayerIds[0]);
      await tx.insert(league_handicap_zones).values({ league_id: leagueId, zone: 4, distance_ft: '39' });
      expect((await getEventHandicap(event.eventId)).zones.map((z) => z.zone)).toEqual([1, 2, 3]);
    });
  });
});

// ---------------------------------------------------------------------------
// Evaluation at completion
// ---------------------------------------------------------------------------

describe('evaluation at event completion', () => {
  it('promotes above the band, queues a demotion below it, and is idempotent', async () => {
    await withRollback(db, async (tx) => {
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const event = await handicapEvent(tx, leagueId, await newPlayers(tx, 8));
      await playEvent(tx, event);
      const { handicapSummary } = await complete(tx, event.eventId);

      const rows = await evaluationsOf(tx, event.eventId);
      expect(rows).toHaveLength(8);
      const promoted = rows.filter((row) => row.decision === 'promote');
      const demoted = rows.filter((row) => row.decision === 'demote');
      expect(promoted.length).toBeGreaterThan(0);
      expect(demoted.length).toBeGreaterThan(0);

      for (const row of rows) {
        const pct = (row.stats as { make_pct: number }).make_pct;
        const expected = pct > 75 ? 'promote' : pct < 50 ? 'demote' : 'stay';
        expect({ player: row.player_id, decision: row.decision }).toEqual({ player: row.player_id, decision: expected });
        const period = await openPeriod(tx, leagueId, row.player_id);
        if (row.decision === 'promote') {
          expect(row.applied).toBe(true);
          expect(period).toMatchObject({ zone: 3, start_reason: 'auto_promote', started_by_event_id: event.eventId });
        } else {
          expect(row.applied).toBe(false);
          expect(period).toMatchObject({ zone: 2, id: row.zone_period_id });
        }
      }
      expect(handicapSummary?.moved_up).toHaveLength(promoted.length);
      expect(handicapSummary?.flagged).toHaveLength(demoted.length);
      expect(await openSuggestions(tx, leagueId)).toHaveLength(demoted.length);

      // The promoted period's history quotes the stats that caused the move.
      const [closed] = await tx.select().from(player_zone_periods).where(eq(player_zone_periods.id, promoted[0].zone_period_id));
      expect(closed.end_stats).toMatchObject({ evaluated_event_id: event.eventId, make_pct: (promoted[0].stats as { make_pct: number }).make_pct });

      const again = await withTransaction(tx, (inner) => evaluateEventHandicaps(inner, event.eventId));
      expect(await evaluationsOf(tx, event.eventId)).toHaveLength(8);
      expect(again).toEqual(handicapSummary);
    });
  });

  it('counts archived matches: a player of a played-out bracket is credited every match they played', async () => {
    await withRollback(db, async (tx) => {
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const event = await handicapEvent(tx, leagueId, await newPlayers(tx, 8));
      await playEvent(tx, event);
      await complete(tx, event.eventId);

      const statuses = await tx.select({ status: bracket_match.status }).from(bracket_match)
        .where(eq(bracket_match.event_id, event.eventId));
      expect(statuses.some((m) => m.status === 5)).toBe(true);

      for (const row of await evaluationsOf(tx, event.eventId)) {
        const entry = await entryOf(tx, event.eventId, row.player_id);
        const played = await tx.selectDistinct({ match: frame_results.bracket_match_id }).from(frame_results)
          .where(eq(frame_results.event_player_id, entry.id));
        expect((row.stats as { matches: number }).matches).toBe(played.length);
      }
    });
  });

  it('moves a player closer automatically only when the league opts in', async () => {
    await withRollback(db, async (tx) => {
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId, { auto_demote_enabled: true });
      const event = await handicapEvent(tx, leagueId, await newPlayers(tx, 8));
      await playEvent(tx, event);
      await complete(tx, event.eventId);

      const demoted = (await evaluationsOf(tx, event.eventId)).filter((row) => row.decision === 'demote');
      expect(demoted.length).toBeGreaterThan(0);
      for (const row of demoted) {
        expect(row.applied).toBe(true);
        expect(await openPeriod(tx, leagueId, row.player_id)).toMatchObject({ zone: 1, start_reason: 'auto_demote' });
      }
      expect(await openSuggestions(tx, leagueId)).toHaveLength(0);
    });
  });

  it('neither moves nor flags a zone-1 player below the threshold', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId, { default_zone: 1 });
      const event = await handicapEvent(tx, leagueId, await newPlayers(tx, 8));
      await playEvent(tx, event);
      await complete(tx, event.eventId);

      const rows = await evaluationsOf(tx, event.eventId);
      expect(rows.some((row) => (row.stats as { make_pct: number }).make_pct < 50)).toBe(true);
      expect(rows.filter((row) => row.decision === 'demote')).toHaveLength(0);
      expect(await openSuggestions(tx, leagueId)).toHaveLength(0);
    });
  });

  it("records a skip instead of deciding for a changed period or an excluded entry", async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const event = await handicapEvent(tx, leagueId, await newPlayers(tx, 8));
      await playEvent(tx, event);

      // Player 0 is on the undefeated team (would be promoted); player 3 on the 0-2 team.
      await setPlayerZone(leagueId, event.playerIds[0], 1, 'Manual change mid-event');
      const excluded = await entryOf(tx, event.eventId, event.playerIds[1]);
      await updateEntryHandicap(event.eventId, excluded.id, { exclude_from_handicap: true, note: 'Shoulder' });
      const { handicapSummary } = await complete(tx, event.eventId);

      const rows = await evaluationsOf(tx, event.eventId);
      const byPlayer = new Map(rows.map((row) => [row.player_id, row]));
      expect(byPlayer.get(event.playerIds[0])).toMatchObject({
        skip_reason: 'period_changed', decision: 'stay', eligible: false, applied: false,
      });
      expect(byPlayer.get(event.playerIds[1])).toMatchObject({
        skip_reason: 'excluded', decision: 'stay', eligible: false, applied: false,
      });
      expect(await openPeriod(tx, leagueId, event.playerIds[0])).toMatchObject({ zone: 1, start_reason: 'manual' });
      expect(await openPeriod(tx, leagueId, event.playerIds[1])).toMatchObject({ zone: 2, start_reason: 'initial' });
      expect(handicapSummary?.skipped.map((s) => s.skip_reason).sort()).toEqual(['excluded', 'period_changed']);
    });
  });

  it('evaluates an event created under handicaps after the league turns them off, and never one created without', async () => {
    await withRollback(db, async (tx) => {
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const withHandicaps = await handicapEvent(tx, leagueId, await newPlayers(tx, 8));
      const without = await handicapEvent(tx, leagueId, await newPlayers(tx, 8), { handicap: false });
      await setSettings(tx, leagueId, { enabled: false });

      await playEvent(tx, withHandicaps);
      await playEvent(tx, without);
      expect((await complete(tx, withHandicaps.eventId)).handicapSummary).not.toBeNull();
      expect((await complete(tx, without.eventId)).handicapSummary).toBeNull();
      expect(await evaluationsOf(tx, withHandicaps.eventId)).toHaveLength(8);
      expect(await evaluationsOf(tx, without.eventId)).toHaveLength(0);
    });
  });

  it('rolls back the status change, periods and evaluations together when completion fails', async () => {
    await withRollback(db, async (tx) => {
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const event = await handicapEvent(tx, leagueId, await newPlayers(tx, 8));
      await playEvent(tx, event);
      // Break the ladder so the runner fails when it needs zone 3's distance.
      await tx.delete(league_handicap_zones).where(and(eq(league_handicap_zones.league_id, leagueId), eq(league_handicap_zones.zone, 3)));
      await tx.insert(league_handicap_zones).values({ league_id: leagueId, zone: 4, distance_ft: '40' });

      await expect(complete(tx, event.eventId)).rejects.toThrow();
      const [row] = await tx.select({ status: events.status }).from(events).where(eq(events.id, event.eventId));
      expect(row.status).toBe('bracket');
      expect(await evaluationsOf(tx, event.eventId)).toHaveLength(0);
      const moved = await tx.select().from(player_zone_periods)
        .where(and(eq(player_zone_periods.league_id, leagueId), eq(player_zone_periods.start_reason, 'auto_promote')));
      expect(moved).toHaveLength(0);
    });
  });

  it('keeps every putt of a zone in one period whatever each event measured it at', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      mockAuth.viewer = null;
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId, { default_zone: 1, min_putts: 100000 });
      const playerIds = await newPlayers(tx, 8);
      const first = await handicapEvent(tx, leagueId, playerIds, { distances: [19, 27, 33] });
      await playEvent(tx, first);
      await complete(tx, first.eventId);
      // Editing the ladder mid-period changes nothing about the period.
      await tx.update(league_handicap_zones).set({ distance_ft: '22' })
        .where(and(eq(league_handicap_zones.league_id, leagueId), eq(league_handicap_zones.zone, 1)));
      const second = await handicapEvent(tx, leagueId, playerIds, { distances: [21, 27, 33] });
      await playEvent(tx, second);
      await complete(tx, second.eventId);

      const handicap = await getPlayerHandicap(playerIds[0], leagueId);
      expect(handicap.current_zone).toBe(1);
      expect(handicap.period.stats.events).toBe(2);
      expect(handicap.career.map((row) => row.distance_ft)).toEqual([19, 21]);
    });
  });
});

// ---------------------------------------------------------------------------
// Review queue and admin changes
// ---------------------------------------------------------------------------

describe('demotion suggestions', () => {
  async function eventWithSuggestions(tx: Executor) {
    const { leagueId } = await seedLeague(tx);
    await enableHandicaps(tx, leagueId);
    const event = await handicapEvent(tx, leagueId, await newPlayers(tx, 8));
    await playEvent(tx, event);
    await complete(tx, event.eventId);
    const suggestions = await openSuggestions(tx, leagueId);
    expect(suggestions.length).toBeGreaterThan(0);
    return { leagueId, event, suggestions };
  }

  it('applies a suggestion as an admin_demote period and refuses a stale one', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId, suggestions } = await eventWithSuggestions(tx);
      const [first, second] = suggestions;

      await resolveZoneSuggestion(leagueId, first.id, 'apply', 'Talked to them');
      expect(await openPeriod(tx, leagueId, first.player_id)).toMatchObject({
        zone: 1, start_reason: 'admin_demote', started_by_user: adminId, note: 'Talked to them',
      });
      const [resolved] = await tx.select().from(player_zone_evaluations).where(eq(player_zone_evaluations.id, first.id));
      expect(resolved).toMatchObject({ resolution: 'applied', resolved_by: adminId });
      await expect(resolveZoneSuggestion(leagueId, first.id, 'apply', null)).rejects.toThrow(ConflictError);

      // A manual change makes the other suggestion moot: superseded, then refused.
      await setPlayerZone(leagueId, second.player_id, 3, 'Placed by hand');
      await expect(resolveZoneSuggestion(leagueId, second.id, 'apply', null)).rejects.toThrow(ConflictError);
      expect(await openPeriod(tx, leagueId, second.player_id)).toMatchObject({ zone: 3 });
    });
  });

  it('supersedes on an eligible re-evaluation, not on an ineligible one, and re-flags a dismissed player', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId, event, suggestions } = await eventWithSuggestions(tx);
      const [dismissed, ...rest] = suggestions;
      await expect(resolveZoneSuggestion(leagueId, dismissed.id, 'dismiss', null)).rejects.toThrow(BadRequestError);
      await resolveZoneSuggestion(leagueId, dismissed.id, 'dismiss', 'Bad night');

      // Ineligible: nothing new to say, the open suggestions stay open.
      await setSettings(tx, leagueId, { min_putts: 100000 });
      const quiet = await handicapEvent(tx, leagueId, event.playerIds);
      await playEvent(tx, quiet);
      await complete(tx, quiet.eventId);
      const stillOpen = await openSuggestions(tx, leagueId);
      expect(stillOpen.map((s) => s.id).sort()).toEqual(rest.map((s) => s.id).sort());

      // Eligible: every older suggestion is superseded; at most one open per player.
      await setSettings(tx, leagueId, { min_putts: 15 });
      const loud = await handicapEvent(tx, leagueId, event.playerIds);
      await playEvent(tx, loud);
      await complete(tx, loud.eventId);
      for (const old of rest) {
        const [row] = await tx.select().from(player_zone_evaluations).where(eq(player_zone_evaluations.id, old.id));
        expect(row.resolution).toBe('superseded');
      }
      const open = await openSuggestions(tx, leagueId);
      expect(new Set(open.map((s) => s.player_id)).size).toBe(open.length);
      expect(open.every((s) => s.event_id === loud.eventId)).toBe(true);
    });
  });
});

describe('public and admin handicap DTOs', () => {
  it('never show a player a note, an actor or a pending suggestion', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId, { default_zone: 3 });
      const playerIds = await newPlayers(tx, 8);
      const event = await handicapEvent(tx, leagueId, playerIds, { status: 'created' });
      await tx.update(events).set({ status: 'pre-bracket' }).where(eq(events.id, event.eventId));
      await playEvent(tx, event);
      await complete(tx, event.eventId);
      const [suggestion] = await openSuggestions(tx, leagueId);
      expect(suggestion).toBeDefined();
      const playerId = suggestion.player_id;
      // A note and an actor on the record as well.
      await tx.update(player_zone_periods).set({ note: 'Shoulder injury', started_by_user: adminId })
        .where(eq(player_zone_periods.id, suggestion.zone_period_id));

      mockAuth.viewer = null;
      const publicView = JSON.stringify(await getPlayerHandicap(playerId, leagueId));
      expect(publicView).not.toMatch(/Shoulder injury|started_by_user|open_suggestion|end_stats|note/);
      expect(publicView).not.toContain(adminId);

      // The viewer must actually administer the league to get the admin DTO.
      mockAuth.viewer = { id: adminId };
      await tx.insert(league_admins).values({ league_id: leagueId, user_id: adminId, role: 'admin' });
      const adminView = await getPlayerHandicap(playerId, leagueId);
      expect(adminView).toMatchObject({ open_suggestion: { evaluation_id: suggestion.id } });
      expect(JSON.stringify(adminView)).toContain('Shoulder injury');
      mockAuth.viewer = null;
    });
  });
});

// ---------------------------------------------------------------------------
// Completed-event immutability and linked events
// ---------------------------------------------------------------------------

describe('completed handicap events', () => {
  it('cannot be deleted, nor have their grand final format changed', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId);
      const event = await handicapEvent(tx, leagueId, await newPlayers(tx, 8));
      await playEvent(tx, event);
      await complete(tx, event.eventId);

      await expect(deleteEvent(event.eventId)).rejects.toThrow(ConflictError);
      await expect(withTransaction(tx, (inner) => updateEventSettingsTx(inner, event.eventId, { double_grand_final: true })))
        .rejects.toThrow(BadRequestError);
    });
  });

  it('pass handicaps and tonight\'s distances on to a second-chance event', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.pg = tx;
      const { leagueId } = await seedLeague(tx);
      await enableHandicaps(tx, leagueId, { min_putts: 100000 });
      const parent = await handicapEvent(tx, leagueId, await newPlayers(tx, 8), { distances: [20, 26, 32] });
      await playEvent(tx, parent);
      await complete(tx, parent.eventId);
      await setSettings(tx, leagueId, { enabled: false });

      const child = await createSecondChanceEvent(parent.eventId, {
        access_code: `sc${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      });
      expect(child.handicap_enabled).toBe(true);
      const entries = await tx.select().from(event_players).where(eq(event_players.event_id, child.id));
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry).toMatchObject({ zone: 2, putt_distance_ft: '26.00' });
        expect(entry.zone_period_id).not.toBeNull();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Concurrency (commits real data)
// ---------------------------------------------------------------------------

describe('race: handicap writers in one league', () => {
  it('two events sharing players complete concurrently: each player evaluated once per event, no deadlock', async () => {
    const { leagueId } = await seedLeague(db);
    const playerIds = await newPlayers(db, 8);
    committed.push({ leagueId, playerIds });
    await enableHandicaps(db, leagueId);
    const first = await handicapEvent(db, leagueId, playerIds);
    const second = await handicapEvent(db, leagueId, playerIds);
    await playEvent(db, first);
    await playEvent(db, second);

    await Promise.all([complete(db, first.eventId), complete(db, second.eventId)]);

    const [a, b] = [await evaluationsOf(db, first.eventId), await evaluationsOf(db, second.eventId)];
    expect(a).toHaveLength(8);
    expect(b).toHaveLength(8);
    const firstDone = a[0].created_at <= b[0].created_at ? a : b;
    const later = firstDone === a ? b : a;
    const movedEarlier = new Set(firstDone.filter((row) => row.applied).map((row) => row.player_id));
    expect(movedEarlier.size).toBeGreaterThan(0);
    for (const row of later) {
      if (movedEarlier.has(row.player_id)) expect(row.skip_reason).toBe('period_changed');
    }
    const open = await db.select().from(player_zone_periods)
      .where(and(eq(player_zone_periods.league_id, leagueId), isNull(player_zone_periods.ended_at)));
    expect(open).toHaveLength(8);
  });

  it('a distance override waits for an in-flight first qualification frame, then refuses', async () => {
    const { leagueId } = await seedLeague(db);
    const [playerId] = await newPlayers(db, 1);
    committed.push({ leagueId, playerIds: [playerId] });
    await enableHandicaps(db, leagueId);
    const event = await handicapEvent(db, leagueId, [playerId]);
    const [entryId] = event.eventPlayerIds;
    mockAuth.pg = db;

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let framed!: () => void;
    const frameWritten = new Promise<void>((resolve) => { framed = resolve; });
    // Like qualification scoring: event row FOR SHARE, no event lock, frame written, not yet committed.
    const scorer = withTransaction(db, async (tx) => {
      await lockQualificationEvent(tx, event.eventId);
      await addQualificationFrame(tx, event.eventId, entryId);
      framed();
      await gate;
    });
    await frameWritten;

    const edit = updateEntryHandicap(event.eventId, entryId, { putt_distance_ft: 25 }).then(() => 'applied', (error) => error);
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await scorer;

    expect(await edit).toBeInstanceOf(ConflictError);
    expect(await entryOf(db, event.eventId, playerId)).toMatchObject({ putt_distance_ft: '27.00', distance_override: false });
  });

  it('two entries racing for a player without a period open one period', async () => {
    const { leagueId } = await seedLeague(db);
    const [playerId] = await newPlayers(db, 1);
    committed.push({ leagueId, playerIds: [playerId] });
    await enableHandicaps(db, leagueId);
    const eventA = await handicapEvent(db, leagueId, []);
    const eventB = await handicapEvent(db, leagueId, []);

    await Promise.all([eventA, eventB].map((event) => withTransaction(db, async (tx) => {
      const [entry] = await tx.insert(event_players)
        .values({ event_id: event.eventId, player_id: playerId, payment_type: 'cash', putt_distance_ft: '15' })
        .returning({ id: event_players.id });
      await refreshEntrySnapshots(tx, event.eventId, { entryIds: [entry.id] });
    })));

    const periods = await db.select().from(player_zone_periods).where(eq(player_zone_periods.player_id, playerId));
    expect(periods).toHaveLength(1);
    expect((await entryOf(db, eventA.eventId, playerId)).zone_period_id).toBe(periods[0].id);
    expect((await entryOf(db, eventB.eventId, playerId)).zone_period_id).toBe(periods[0].id);
  });
});
