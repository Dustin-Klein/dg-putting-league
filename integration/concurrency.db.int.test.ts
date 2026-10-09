/**
 * Concurrency tests: these commit real data (each iteration seeds its own event) so
 * that two connections genuinely race. Seeds are removed in afterAll.
 */
import { eq } from 'drizzle-orm';
import { events } from '@/lib/db/schema';
import { getEventBracketConfig } from '@/lib/repositories/event-repository.db';
import { completeMatch } from '@/lib/services/scoring/match-completion';
import { recordFrameScores } from '@/lib/services/scoring/score-submission';
import { MatchStatus } from '@/lib/types/bracket';
import { closeDb, createTestDb } from './db/harness';
import { cleanupLeague, getBracketSnapshot, getParticipantPlayers, seedBracket, type SeededEvent } from './db/seed';
import { expectLaneInvariants, expectScoresMatchFrames, getMatch, opponentId } from './db/play';

const ITERATIONS = 50;

const db = createTestDb(20);
const seeded: SeededEvent[] = [];

afterAll(async () => {
  for (const event of seeded) {
    await cleanupLeague(db, event);
  }
  await closeDb(db);
});

async function newBracket(teams: number, laneCount = 2) {
  const event = await seedBracket(db, { teams, laneCount });
  seeded.push(event);
  return event;
}

describe('race: complete vs. score', () => {
  it(`never records a frame after completion and keeps result consistent with scores (${ITERATIONS}x)`, async () => {
    const outcomes = { scoreFirst: 0, completeFirst: 0 };

    for (let i = 0; i < ITERATIONS; i++) {
      const event = await newBracket(4);
      const snap = await getBracketSnapshot(db, event.eventId);
      const match = snap.matches.find(
        (m) => m.status === MatchStatus.Ready && opponentId(m.opponent1) != null && opponentId(m.opponent2) != null
      )!;
      const team1 = await getParticipantPlayers(db, event.eventId, opponentId(match.opponent1)!);
      const team2 = await getParticipantPlayers(db, event.eventId, opponentId(match.opponent2)!);

      // Five regulation frames: team 1 leads 25-20.
      for (let frame = 1; frame <= 5; frame++) {
        await recordFrameScores(db, {
          eventId: event.eventId,
          matchId: match.id,
          frameNumber: frame,
          scorer: 'public',
          scores: [
            { event_player_id: team1[0], putts_made: 3 },
            { event_player_id: team1[1], putts_made: 1 },
            { event_player_id: team2[0], putts_made: 3 },
            { event_player_id: team2[1], putts_made: 0 },
          ],
        });
      }

      // Another device submits a frame that would flip the result, while this one completes.
      const [completion, lateScore] = await Promise.allSettled([
        completeMatch(db, event.eventId, match.id),
        recordFrameScores(db, {
          eventId: event.eventId,
          matchId: match.id,
          frameNumber: 6,
          scorer: 'public',
          scores: [
            { event_player_id: team2[0], putts_made: 3 },
            { event_player_id: team2[1], putts_made: 3 },
            { event_player_id: team1[0], putts_made: 0 },
            { event_player_id: team1[1], putts_made: 0 },
          ],
        }),
      ]);

      expect(completion.status).toBe('fulfilled');
      const stored = await getMatch(db, match.id);
      expect(stored.status === MatchStatus.Completed || stored.status === MatchStatus.Archived).toBe(true);
      await expectScoresMatchFrames(db, event.eventId, match.id);

      const o1 = stored.opponent1 as { score: number; result: string };
      const o2 = stored.opponent2 as { score: number; result: string };
      const [winner, loser] = o1.result === 'win' ? [o1, o2] : [o2, o1];
      expect(winner.score).toBeGreaterThan(loser.score);

      if (lateScore.status === 'fulfilled') {
        // The frame landed before completion, so completion saw it: team 2 won.
        outcomes.scoreFirst++;
        expect(o2.result).toBe('win');
      } else {
        outcomes.completeFirst++;
        expect((lateScore.reason as Error).message).toBe('Match is already completed');
        expect(o1.result).toBe('win');
      }
    }

    // Not an invariant, just visibility into how often each interleaving happened.
    console.info('complete vs. score outcomes', outcomes);
  });
});

describe('race: sibling completions', () => {
  it(`both winners reach the shared next match (${ITERATIONS}x)`, async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const event = await newBracket(4);
      let snap = await getBracketSnapshot(db, event.eventId);
      const [m1, m2] = snap.matches.filter((m) => m.group_number === 1 && m.round_number === 1);
      const wbFinal = snap.matches.find((m) => m.group_number === 1 && m.round_number === 2)!;
      const lbFirst = snap.matches.find((m) => m.group_number === 2 && m.round_number === 1)!;

      const results = await Promise.allSettled([
        completeMatch(db, event.eventId, m1.id, { team1Score: 20, team2Score: 10 }),
        completeMatch(db, event.eventId, m2.id, { team1Score: 8, team2Score: 15 }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);

      snap = await getBracketSnapshot(db, event.eventId);
      const next = snap.matches.find((m) => m.id === wbFinal.id)!;
      expect(next.status).toBe(MatchStatus.Ready);
      expect(new Set([opponentId(next.opponent1), opponentId(next.opponent2)])).toEqual(
        new Set([opponentId(m1.opponent1), opponentId(m2.opponent2)])
      );

      const losers = snap.matches.find((m) => m.id === lbFirst.id)!;
      expect(losers.status).toBe(MatchStatus.Ready);
      expect(new Set([opponentId(losers.opponent1), opponentId(losers.opponent2)])).toEqual(
        new Set([opponentId(m1.opponent2), opponentId(m2.opponent1)])
      );

      expectLaneInvariants(snap);
    }
  });
});

describe('race: concurrent scorers on one frame', () => {
  it(`assigns distinct order_in_frame values (${ITERATIONS}x)`, async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const event = await newBracket(4);
      const snap = await getBracketSnapshot(db, event.eventId);
      const match = snap.matches.find((m) => m.status === MatchStatus.Ready)!;
      const players = [
        ...(await getParticipantPlayers(db, event.eventId, opponentId(match.opponent1)!)),
        ...(await getParticipantPlayers(db, event.eventId, opponentId(match.opponent2)!)),
      ];

      const results = await Promise.allSettled(
        players.map((id) =>
          recordFrameScores(db, {
            eventId: event.eventId,
            matchId: match.id,
            frameNumber: 1,
            scorer: 'public',
            scores: [{ event_player_id: id, putts_made: 2 }],
          })
        )
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      await expectScoresMatchFrames(db, event.eventId, match.id);
    }
  });
});

describe('race: event completion vs. bracket writes', () => {
  it('cannot complete the event while a bracket write holds the event row, and writes after completion are rejected', async () => {
    const event = await newBracket(4);
    const match = (await getBracketSnapshot(db, event.eventId)).matches.find((m) => m.status === MatchStatus.Ready)!;

    let completedEvent: Promise<unknown> | undefined;
    let settled = false;
    await db.transaction(async (tx) => {
      // What every bracket write does before touching matches
      await getEventBracketConfig(tx, event.eventId, { lock: 'share' });
      completedEvent = db
        .update(events)
        .set({ status: 'completed' })
        .where(eq(events.id, event.eventId))
        .then(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false); // blocked behind the write's share lock
    });
    await completedEvent;
    expect(settled).toBe(true);

    await expect(
      completeMatch(db, event.eventId, match.id, { team1Score: 10, team2Score: 5 })
    ).rejects.toThrow('Event is not in bracket play');
  });
});
