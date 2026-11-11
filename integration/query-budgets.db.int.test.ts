/**
 * Statement budgets for hot write paths: the number of statements must not grow with
 * the number of players, teams, matches or lanes. Counts include savepoints.
 */
import { resetMatchResult } from '@/lib/services/bracket/bracket-service';
import { syncMatchScores } from '@/lib/services/scoring/match-scores';
import { recordFrameScores } from '@/lib/services/scoring/score-submission';
import { autoAssignLanesTx } from '@/lib/services/lane';
import { getZoneSeedCandidates, seedPlayerZones } from '@/lib/services/handicap/zone-service';
import {
  bracket_match,
  event_players,
  events,
  frame_results,
  lanes as lanesTable,
  league_handicap_settings,
  league_handicap_zones,
  match_frames,
  players as playersTable,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { closeDb, createCountingTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, getParticipantPlayers, seedBracket, seedLeague } from './db/seed';
import { expectLaneInvariants, opponentId, playMatch, playableMatches } from './db/play';

// resetMatchResult authorizes with requireEventAdmin; hand it the test transaction instead.
const mockAdmin: { tx?: Executor } = {};
jest.mock('@/lib/services/event/event-service', () => {
  const actual = jest.requireActual('@/lib/services/event/event-service');
  return {
    ...actual,
    requireEventAdmin: async () => ({ pg: mockAdmin.tx, user: { id: null } }),
  };
});

jest.mock('@/lib/services/auth', () => ({
  ...jest.requireActual('@/lib/services/auth'),
  authorizeLeagueAdmin: async () => ({ pg: mockAdmin.tx, user: { id: null } }),
}));

const counting = createCountingTestDb();
afterAll(() => closeDb(counting.db));

describe('statement budgets', () => {
  it('syncs a match score in one read and one write', async () => {
    await withRollback(counting.db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const [match] = playableMatches(await getBracketSnapshot(tx, event.eventId));
      const team1 = await getParticipantPlayers(tx, event.eventId, opponentId(match.opponent1)!);
      await recordFrameScores(tx, {
        eventId: event.eventId,
        matchId: match.id,
        frameNumber: 1,
        scorer: 'public',
        scores: team1.map((id) => ({ event_player_id: id, putts_made: 3 })),
      });

      const { total } = await counting.count(() => syncMatchScores(tx, match.id));
      expect(total).toBe(2);
    });
  });

  it('records a frame for a whole match in the same number of statements for 2 or 8 players', async () => {
    const totals: number[] = [];
    for (const teamSize of [1, 4]) {
      await withRollback(counting.db, async (tx) => {
        const event = await seedBracket(tx, { teams: 2 });
        const [match] = playableMatches(await getBracketSnapshot(tx, event.eventId));
        const players = [
          ...(await getParticipantPlayers(tx, event.eventId, opponentId(match.opponent1)!)),
          ...(await getParticipantPlayers(tx, event.eventId, opponentId(match.opponent2)!)),
        ].slice(0, teamSize * 2);
        const { total } = await counting.count(() =>
          recordFrameScores(tx, {
            eventId: event.eventId,
            matchId: match.id,
            frameNumber: 1,
            scorer: 'public',
            scores: players.map((id) => ({ event_player_id: id, putts_made: 2 })),
          })
        );
        totals.push(total);
      });
    }
    expect(totals[1]).toBe(totals[0]);
  });

  it('assigns any number of lanes in the same number of statements', async () => {
    const totals: number[] = [];
    for (const laneCount of [1, 8]) {
      await withRollback(counting.db, async (tx) => {
        const event = await seedBracket(tx, { teams: 16, laneCount });
        // Free every lane, then assign them all again.
        await tx.update(lanesTable).set({ status: 'idle' }).where(eq(lanesTable.event_id, event.eventId));
        await tx.update(bracket_match).set({ lane_id: null, lane_assigned_at: null }).where(eq(bracket_match.event_id, event.eventId));

        let assigned = 0;
        const { total } = await counting.count(async () => {
          assigned = await autoAssignLanesTx(tx, event.eventId);
        });
        expect(assigned).toBe(laneCount);
        expectLaneInvariants(await getBracketSnapshot(tx, event.eventId));
        totals.push(total);
      });
    }
    expect(totals[1]).toBe(totals[0]);
  });

  it('resets a match without graph reads: one write per rewritten match on top of a fixed budget', async () => {
    const overheads: number[] = [];
    for (const teams of [8, 32]) {
      await withRollback(counting.db, async (tx) => {
        mockAdmin.tx = tx;
        const event = await seedBracket(tx, { teams, laneCount: 2 });
        // Play the first winners-bracket match and everything it feeds, a few levels deep.
        const [first] = playableMatches(await getBracketSnapshot(tx, event.eventId));
        await playMatch(tx, event.eventId, first.id, 'opponent1');
        for (let i = 0; i < 3; i++) {
          const [next] = playableMatches(await getBracketSnapshot(tx, event.eventId));
          if (next) await playMatch(tx, event.eventId, next.id, 'opponent2');
        }

        let resetCount = 0;
        const { total } = await counting.count(async () => {
          resetCount = (await resetMatchResult(event.eventId, first.id)).resetMatchIds.length;
        });
        overheads.push(total - resetCount);
        expectLaneInvariants(await getBracketSnapshot(tx, event.eventId));
      });
    }
    // Lock, snapshot, lock rewritten rows, release lanes, frames, overrides, grand
    // final check and lane reassignment: the same fixed set whatever the bracket's size.
    for (const overhead of overheads) expect(overhead).toBeLessThanOrEqual(18);
  });

  it('reads the zone seeding field in the same number of statements for any number of players', async () => {
    const totals: number[] = [];
    for (const playerCount of [2, 40]) {
      await withRollback(counting.db, async (tx) => {
        mockAdmin.tx = tx;
        const { leagueId } = await seedLeague(tx);
        await tx.insert(league_handicap_settings).values({ league_id: leagueId, enabled: true });
        await tx.insert(league_handicap_zones).values([
          { league_id: leagueId, zone: 1, distance_ft: '21' },
          { league_id: leagueId, zone: 2, distance_ft: '27' },
        ]);
        const { leagueId: sourceId } = await seedLeague(tx);
        const [event] = await tx.insert(events).values({
          league_id: sourceId,
          event_date: '2026-02-01',
          location: 'History',
          lane_count: 1,
          putt_distance_ft: '20',
          access_code: `qb${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
          status: 'completed',
          entry_fee_per_player: null,
          admin_fees: null,
          admin_fee_per_player: null,
          payout_pool_override: null,
        }).returning({ id: events.id });
        const inserted = await tx.insert(playersTable)
          .values(Array.from({ length: playerCount }, (_, i) => ({ full_name: `Budget ${i}` })))
          .returning({ id: playersTable.id });
        const entries = await tx.insert(event_players)
          .values(inserted.map((row) => ({ event_id: event.id, player_id: row.id, payment_type: 'cash', putt_distance_ft: '20' })))
          .returning({ id: event_players.id });
        const [frame] = await tx.insert(match_frames).values({ frame_number: 1 }).returning({ id: match_frames.id });
        await tx.insert(frame_results).values(entries.map((entry) => ({
          match_frame_id: frame.id, event_player_id: entry.id, putts_made: 2, points_earned: 2, order_in_frame: 1,
        })));

        let listed = 0;
        const { total } = await counting.count(async () => {
          listed = (await getZoneSeedCandidates(leagueId, sourceId)).candidates.length;
        });
        expect(listed).toBe(playerCount);
        totals.push(total);
      });
    }
    expect(totals[1]).toBe(totals[0]);
  });

  it('re-seeds starting zones in the same number of statements for any number of players', async () => {
    const totals: number[] = [];
    for (const playerCount of [2, 40]) {
      await withRollback(counting.db, async (tx) => {
        mockAdmin.tx = tx;
        const { leagueId } = await seedLeague(tx);
        await tx.insert(league_handicap_settings).values({ league_id: leagueId, enabled: true });
        await tx.insert(league_handicap_zones).values([
          { league_id: leagueId, zone: 1, distance_ft: '21' },
          { league_id: leagueId, zone: 2, distance_ft: '27' },
        ]);
        const inserted = await tx.insert(playersTable)
          .values(Array.from({ length: playerCount }, (_, i) => ({ full_name: `Budget ${i}` })))
          .returning({ id: playersTable.id });
        const seed = (zone: number) => seedPlayerZones(leagueId, inserted.map((row) => ({ player_id: row.id, zone })));
        await seed(1);

        let applied = 0;
        const { total } = await counting.count(async () => {
          applied = (await seed(2)).applied;
        });
        expect(applied).toBe(playerCount);
        totals.push(total);
      });
    }
    expect(totals[1]).toBe(totals[0]);
  });
});
