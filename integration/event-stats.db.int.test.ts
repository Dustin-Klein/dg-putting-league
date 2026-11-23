jest.mock('@/lib/services/auth/auth-service', () => ({
  authorizeEventView: jest.fn(),
  authorizeEventAdmin: jest.fn(),
}));

import { and, eq, inArray, sql } from 'drizzle-orm';
import { bracket_match, event_players, events, frame_results, qualification_frames, qualification_rounds } from '@/lib/db/schema';
import type { Tx } from '@/lib/db/tx';
import { authorizeEventAdmin, authorizeEventView } from '@/lib/services/auth/auth-service';
import { startBracket, updateEventSettingsTx } from '@/lib/services/event/event-service';
import { _clearEventStatsCaches, getAdminEventStats, getPublicEventStats } from '@/lib/services/event-stats/event-stats-service';
import { recordFrameScores } from '@/lib/services/scoring/score-submission';
import { completeMatch } from '@/lib/services/scoring/match-completion';
import { syncMatchScores } from '@/lib/services/scoring/match-scores';
import type { PublicEventStats } from '@/lib/types/event-stats';
import { closeDb, createCountingTestDb, createTestDb, withRollback } from './db/harness';
import { getMatch, opponentId, playMatch, playOutBracket, playableMatches } from './db/play';
import { buildDeterministicPairings, getBracketSnapshot, getParticipantPlayers, seedBracket, seedEvent } from './db/seed';

const db = createTestDb();
const counting = createCountingTestDb();
afterAll(async () => {
  await closeDb(db);
  await closeDb(counting.db);
});
beforeEach(() => _clearEventStatsCaches());

async function authorizeAs(tx: Tx, eventId: string, admin: boolean) {
  const [event] = await tx.select({
    id: events.id,
    league_id: events.league_id,
    status: events.status,
    qualification_round_enabled: events.qualification_round_enabled,
  }).from(events).where(eq(events.id, eventId));
  const access = { ...event, admin_role: admin ? 'owner' : null };
  (authorizeEventView as jest.Mock).mockResolvedValue({ user: null, event: access, isAdmin: admin, pg: tx });
  (authorizeEventAdmin as jest.Mock).mockResolvedValue({ user: { id: 'admin' }, event: access, pg: tx });
}

function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, keys));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      keys.add(key);
      allKeys(v, keys);
    }
  }
  return keys;
}

function expectReconciles(stats: PublicEventStats) {
  const sum = (key: 'frames' | 'points') => stats.players.reduce((total, p) => total + p.line[key], 0);
  expect(stats.field.frames).toBe(sum('frames'));
  expect(stats.field.points).toBe(sum('points'));
  for (const team of stats.standings) {
    const members = stats.players.filter((p) => p.team_id === team.team_id);
    expect(team.line.frames).toBe(members.reduce((t, p) => t + p.line.frames, 0));
  }
  const groupFrames = stats.zone_groups.reduce((t, g) => t + g.line.frames, 0);
  expect(groupFrames).toBe(stats.field.frames);
}

describe('event stats', () => {
  it('reports a live event from its frames: progress, standings, reconciled totals', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4, laneCount: 2, doubleGrandFinal: false });
      const snap = await getBracketSnapshot(tx, event.eventId);
      const [first, second] = playableMatches(snap);
      await playMatch(tx, event.eventId, first.id, 'opponent1');
      // Second match: two frames scored, still in progress.
      const team1 = await getParticipantPlayers(tx, event.eventId, opponentId(second.opponent1)!);
      const team2 = await getParticipantPlayers(tx, event.eventId, opponentId(second.opponent2)!);
      for (const frameNumber of [1, 2]) {
        await recordFrameScores(tx, {
          eventId: event.eventId, matchId: second.id, frameNumber, scorer: 'public',
          scores: [...team1.map((id) => ({ event_player_id: id, putts_made: 2 })), ...team2.map((id) => ({ event_player_id: id, putts_made: 1 }))],
        });
      }
      await authorizeAs(tx, event.eventId, false);

      const stats = await getPublicEventStats(event.eventId);

      expect(stats.event.status).toBe('bracket');
      expect(stats.progress.completed).toBe(1);
      expect(stats.progress.in_progress).toBe(1);
      expect(stats.progress.total).toBeGreaterThanOrEqual(6);
      expect(stats.standings.every((s) => s.placement === null)).toBe(true);
      expect(stats.standings.filter((s) => s.status === 'playing')).toHaveLength(2);
      // 5 frames × 4 players + 2 frames × 4 players
      expect(stats.field.frames).toBe(28);
      // Winners: 3 putts every frame (4 points with the bonus) for 5 frames.
      const winner = stats.players.find((p) => p.line.frames === 5 && p.line.made === 15)!;
      expect(winner.line.points).toBe(20);
      expect(winner.line.make_rate).toBe(1);
      expect(winner.line.points_per_match).toBe(20);
      expect(winner.best_match).toBeNull(); // 5 frames is a small sample
      expect(winner.small_sample).toBe(true);
      expect(stats.matches.completed).toBe(1);
      expect(stats.matches.margins.find((m) => m.margin === 30)?.count).toBe(1);
      expectReconciles(stats);
    });
  });

  it('excludes BYEs and the unused grand-final reset, and shows placements after completion', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 3, doubleGrandFinal: true });
      await playOutBracket(tx, event.eventId, () => 'opponent1');
      await updateEventSettingsTx(tx, event.eventId, { status: 'completed' });
      await authorizeAs(tx, event.eventId, false);

      const stats = await getPublicEventStats(event.eventId);
      const matchRows = await tx.select().from(bracket_match).where(eq(bracket_match.event_id, event.eventId));
      const withFrames = new Set((await tx.select({ id: frame_results.bracket_match_id }).from(frame_results)
        .where(inArray(frame_results.bracket_match_id, matchRows.map((m) => m.id)))).map((r) => r.id));

      expect(stats.event.status).toBe('completed');
      expect(stats.progress.completed).toBe(withFrames.size);
      expect(stats.progress.total).toBe(withFrames.size);
      expect(stats.standings.map((s) => s.placement)).toEqual([1, 2, 3]);
      expect(stats.standings.every((s) => s.status === null)).toBe(true);
      const wins = stats.standings.reduce((t, s) => t + s.wins, 0);
      const losses = stats.standings.reduce((t, s) => t + s.losses, 0);
      expect(wins).toBe(withFrames.size);
      expect(losses).toBe(withFrames.size);
      expectReconciles(stats);
    });
  });

  it('keeps manual-only and conflicting overrides out of player stats, and flags them for admins', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4, laneCount: 2, doubleGrandFinal: false });
      const [a, b] = playableMatches(await getBracketSnapshot(tx, event.eventId));
      // a: frames, then an override that disagrees with them.
      await playMatch(tx, event.eventId, a.id, 'opponent1');
      await tx.update(bracket_match).set({ score_override_1: 21, score_override_2: 19 }).where(eq(bracket_match.id, a.id));
      await syncMatchScores(tx, a.id);
      // b: manual score only.
      await tx.update(bracket_match).set({ score_override_1: 15, score_override_2: 14 }).where(eq(bracket_match.id, b.id));
      await syncMatchScores(tx, b.id);
      await completeMatch(tx, event.eventId, b.id);
      await authorizeAs(tx, event.eventId, true);

      const admin = await getAdminEventStats(event.eventId);

      expect(admin.matches.completed).toBe(2);
      expect(admin.close_matches).toBe(2);
      expect(admin.field.frames).toBe(20);
      expect(admin.warnings.map((w) => w.kind).sort()).toEqual(['manual_only', 'override_conflict']);
      const bPlayers = (await getParticipantPlayers(tx, event.eventId, opponentId((await getMatch(tx, b.id)).opponent1)!));
      for (const id of bPlayers) {
        expect(admin.players.find((p) => p.entry_id === id)!.matches).toBe(0);
      }
      expect(admin.teams.find((t) => t.wins === 1 && t.line.frames === 0)).toBeDefined();
    });
  });

  it('never sends admin-only data publicly and hides a private linked event', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 2, doubleGrandFinal: false });
      await playOutBracket(tx, event.eventId, () => 'opponent1');
      await tx.update(event_players).set({ exclude_from_handicap: true, handicap_note: 'secret note' })
        .where(eq(event_players.id, event.eventPlayerIds[0]));
      const [round] = await tx.insert(qualification_rounds).values({ event_id: event.eventId, status: 'completed' })
        .returning({ id: qualification_rounds.id });
      await tx.insert(qualification_frames).values({
        qualification_round_id: round.id, event_id: event.eventId, event_player_id: event.eventPlayerIds[0],
        frame_number: 1, putts_made: 2, points_earned: 2, putt_distance_ft: '25',
      });
      const child = await seedEvent(tx, { players: 0, status: 'created', leagueId: event.leagueId });
      await tx.update(events).set({ parent_event_id: event.eventId, link_type: 'second_chance' }).where(eq(events.id, child.eventId));
      await authorizeAs(tx, event.eventId, false);

      const stats = await getPublicEventStats(event.eventId);
      for (const key of ['warnings', 'entry_flags', 'qualification', 'evaluations', 'analytics', 'children', 'teams']) {
        expect(Object.keys(stats)).not.toContain(key);
      }
      const keys = allKeys(stats);
      for (const key of ['handicap_note', 'exclude_from_handicap', 'distance_override', 'payment_type', 'access_code',
        'email', 'player_id', 'note', 'zero_frame_members', 'window']) {
        expect(keys.has(key)).toBe(false);
      }
      expect(JSON.stringify(stats)).not.toContain('secret note');
      expect(stats.child).toBeNull();

      await authorizeAs(tx, event.eventId, true);
      const admin = await getAdminEventStats(event.eventId);
      expect(admin.children).toEqual([expect.objectContaining({ id: child.eventId, status: 'created' })]);
      expect(admin.qualification).toEqual([expect.objectContaining({ entry_id: event.eventPlayerIds[0], frames: 1, points: 2 })]);
      expect(admin.entry_flags).toEqual([expect.objectContaining({ flag: 'excluded', note: 'secret note' })]);

      await tx.update(events).set({ status: 'bracket' }).where(eq(events.id, child.eventId));
      _clearEventStatsCaches();
      await authorizeAs(tx, event.eventId, false);
      expect((await getPublicEventStats(event.eventId)).child).toEqual(expect.objectContaining({ id: child.eventId }));
    });
  });

  it('refuses events whose bracket is not visible', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedEvent(tx, { players: 4, status: 'pre-bracket' });
      await authorizeAs(tx, event.eventId, true);
      await expect(getPublicEventStats(event.eventId)).rejects.toThrow('Event not found');
      await expect(getAdminEventStats(event.eventId)).rejects.toThrow('bracket play');
    });
  });

  it('shows "—" for make % on imported points-only events', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 2, doubleGrandFinal: false });
      await playOutBracket(tx, event.eventId, () => 'opponent1');
      await tx.update(events).set({ putt_counts_reliable: false }).where(eq(events.id, event.eventId));
      await authorizeAs(tx, event.eventId, false);
      const stats = await getPublicEventStats(event.eventId);
      expect(stats.event.putt_counts_reliable).toBe(false);
      expect(stats.field.make_rate).toBeNull();
      expect(stats.field.made).toBeNull();
      expect(stats.zone_groups.every((g) => g.mix === null)).toBe(true);
      expect(stats.players.every((p) => p.line.threes === null && p.line.points > 0)).toBe(true);
    });
  });

  it('builds season context from earlier completed league events, same-night parent first', async () => {
    await withRollback(db, async (tx) => {
      const earlier = await seedBracket(tx, { teams: 2, doubleGrandFinal: false });
      await playOutBracket(tx, earlier.eventId, () => 'opponent1');
      await updateEventSettingsTx(tx, earlier.eventId, { status: 'completed', force: true });

      // A same-date event in the same league with the same players, created later.
      const later = await seedEvent(tx, { players: 0, leagueId: earlier.leagueId });
      // Rows created in one transaction share now(); make the creation order explicit.
      await tx.update(events).set({ created_at: sql`created_at + interval '1 minute'` }).where(eq(events.id, later.eventId));
      await tx.insert(event_players).values(earlier.playerIds.map((player_id) => ({
        event_id: later.eventId, player_id, payment_type: 'cash', putt_distance_ft: '25',
      })));
      const entries = await tx.select({ id: event_players.id, player_id: event_players.player_id }).from(event_players)
        .where(eq(event_players.event_id, later.eventId));
      const byPlayer = new Map(entries.map((e) => [e.player_id, e.id]));
      const seeded = { ...earlier, eventId: later.eventId, eventPlayerIds: earlier.playerIds.map((id) => byPlayer.get(id)!) };
      const { poolAssignments, teamPairings } = buildDeterministicPairings(seeded);
      await startBracket(tx, later.eventId, poolAssignments, teamPairings);
      await authorizeAs(tx, later.eventId, false);

      const stats = await getPublicEventStats(later.eventId);
      const seasonFrames = await tx.select({ id: frame_results.id }).from(frame_results)
        .innerJoin(event_players, eq(event_players.id, frame_results.event_player_id))
        .where(and(eq(event_players.event_id, earlier.eventId), eq(event_players.player_id, earlier.playerIds[0])));
      const p0 = stats.players.find((p) => p.entry_id === byPlayer.get(earlier.playerIds[0]))!;
      expect(p0.season?.frames).toBe(seasonFrames.length);
      expect(p0.season?.label).toBe('25 ft');
      expect(stats.season?.field?.label).toBe('All distances');

      // The earlier event does not see the later one.
      await authorizeAs(tx, earlier.eventId, false);
      const before = await getPublicEventStats(earlier.eventId);
      expect(before.players.every((p) => p.season?.frames === 0)).toBe(true);
    });
  });

  it('reads the report in a fixed number of statements, whatever the event size', async () => {
    const budget = async (teams: number) => {
      let totals = { publicTotal: 0, adminTotal: 0 };
      await withRollback(counting.db, async (tx) => {
        const event = await seedBracket(tx, { teams, laneCount: 2, doubleGrandFinal: false });
        await playOutBracket(tx, event.eventId, () => 'opponent1');
        await authorizeAs(tx, event.eventId, true);
        _clearEventStatsCaches();
        const pub = await counting.count(() => getPublicEventStats(event.eventId));
        const admin = await counting.count(() => getAdminEventStats(event.eventId));
        totals = { publicTotal: pub.total, adminTotal: admin.total };
      });
      return totals;
    };
    const small = await budget(2);
    const large = await budget(8);
    expect(large).toEqual(small);
    // Savepoint, snapshot, release; then the two season queries (cached for later requests).
    expect(small.publicTotal).toBeLessThanOrEqual(5);
    expect(small.adminTotal).toBeLessThanOrEqual(8);
  });
});
