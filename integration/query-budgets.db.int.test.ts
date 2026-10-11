/**
 * Statement budgets for hot write paths: the number of statements must not grow with
 * the number of players, teams, matches or lanes. Counts include savepoints.
 */
import { resetMatchResult } from '@/lib/services/bracket/bracket-service';
import { syncMatchScores } from '@/lib/services/scoring/match-scores';
import { recordFrameScores } from '@/lib/services/scoring/score-submission';
import { autoAssignLanesTx } from '@/lib/services/lane';
import { bracket_match, lanes as lanesTable } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { closeDb, createCountingTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, getParticipantPlayers, seedBracket } from './db/seed';
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
});
