import { eq, inArray } from 'drizzle-orm';
import { bracket_match, match_frames } from '@/lib/db/schema';
import { completeMatch } from '@/lib/services/scoring/match-completion';
import { correctMatchScores } from '@/lib/services/scoring/match-scoring';
import { recordFrameScores } from '@/lib/services/scoring/score-submission';
import { resetMatchResult } from '@/lib/services/bracket/bracket-service';
import { MatchStatus } from '@/lib/types/bracket';
import type { Executor } from '@/lib/db/tx';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, getParticipantPlayers, seedBracket, type BracketSnapshot } from './db/seed';
import {
  expectLaneInvariants,
  expectScoresMatchFrames,
  getMatch,
  opponentId,
  playMatch,
  playOutBracket,
  playableMatches,
  scoreMatch,
} from './db/play';

// resetMatchResult authorizes with requireEventAdmin; hand it the test transaction instead.
const mockAdmin: { tx?: Executor } = {};
jest.mock('@/lib/services/event/event-service', () => {
  const actual = jest.requireActual('@/lib/services/event/event-service');
  return {
    ...actual,
    requireEventAdmin: async () => ({ pg: mockAdmin.tx, supabase: null, user: { id: 'test-admin' } }),
  };
});
jest.mock('@/lib/repositories/bracket-repository', () => {
  const actual = jest.requireActual<typeof import('@/lib/repositories/bracket-repository')>(
    '@/lib/repositories/bracket-repository'
  );
  return {
    ...actual,
    getMatchForScoringById: async (_client: unknown, matchId: number) => ({
      ...(await getMatch(mockAdmin.tx!, matchId)),
      frames: [],
    }),
  };
});
jest.mock('@/lib/repositories/event-repository', () => {
  const actual = jest.requireActual<typeof import('@/lib/repositories/event-repository')>(
    '@/lib/repositories/event-repository'
  );
  return {
    ...actual,
    getEventBracketFrameCount: jest.fn().mockResolvedValue(5),
    getEventScoringConfig: jest.fn().mockResolvedValue({ bonus_point_enabled: true }),
  };
});
jest.mock('@/lib/repositories/team-repository', () => {
  const actual = jest.requireActual<typeof import('@/lib/repositories/team-repository')>(
    '@/lib/repositories/team-repository'
  );
  return {
    ...actual,
    getTeamFromParticipant: jest.fn().mockResolvedValue(null),
  };
});

const db = createTestDb();
afterAll(() => closeDb(db));

const GRAND_FINAL_GROUP = 3;

// Small deterministic PRNG so failures reproduce.
function prng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

function gfMatches(snap: BracketSnapshot) {
  return snap.matches.filter((m) => m.group_number === GRAND_FINAL_GROUP);
}

// brackets-manager archives (5) a completed match once the matches it feeds are done,
// so "decided" means status 4 or 5 with a result.
function isDecided(m: BracketSnapshot['matches'][number]): boolean {
  return (
    (m.status === MatchStatus.Completed || m.status === MatchStatus.Archived) &&
    opponentId(m.opponent1) != null &&
    opponentId(m.opponent2) != null &&
    (m.opponent1 as { result?: string }).result != null
  );
}

function expectFinished(snap: BracketSnapshot) {
  for (const m of snap.matches) {
    const filled = opponentId(m.opponent1) != null && opponentId(m.opponent2) != null;
    if (isDecided(m)) {
      const o1 = m.opponent1 as { score: number; result: string };
      const o2 = m.opponent2 as { score: number; result: string };
      const winnerScore = o1.result === 'win' ? o1.score : o2.score;
      const loserScore = o1.result === 'win' ? o2.score : o1.score;
      expect(winnerScore).toBeGreaterThan(loserScore);
    } else if (m.status !== MatchStatus.Archived) {
      // Anything left open must be an empty BYE slot, never a stranded match.
      expect({ match: m.id, filled }).toEqual({ match: m.id, filled: false });
    }
  }
}

describe.each([
  { teams: 8, doubleGrandFinal: true, lanes: 3 },
  { teams: 12, doubleGrandFinal: true, lanes: 4 },
  { teams: 12, doubleGrandFinal: false, lanes: 2 },
  { teams: 16, doubleGrandFinal: true, lanes: 4 },
  { teams: 17, doubleGrandFinal: true, lanes: 4 },
  { teams: 19, doubleGrandFinal: true, lanes: 4 },
])('full tournament: $teams teams, double GF $doubleGrandFinal', ({ teams, doubleGrandFinal, lanes }) => {
  it.each([
    ['WB champion wins the grand final', 'opponent1' as const],
    ['LB champion forces the reset', 'opponent2' as const],
  ])('%s', async (_label, gfWinner) => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams, laneCount: lanes, doubleGrandFinal });
      const random = prng(teams * 7 + (gfWinner === 'opponent1' ? 1 : 2));

      let gf1Played = false;
      const played = await playOutBracket(tx, event.eventId, (m) => {
        if (m.group_number === GRAND_FINAL_GROUP && m.round_number === 1) {
          gf1Played = true;
          return gfWinner;
        }
        return random() < 0.5 ? 'opponent1' : 'opponent2';
      });
      expect(gf1Played).toBe(true);

      const snap = await getBracketSnapshot(tx, event.eventId);
      expectFinished(snap);
      expectLaneInvariants(snap);
      expect(snap.lanes.every((l) => l.status === 'idle')).toBe(true);

      const [gf1, gf2] = gfMatches(snap);
      expect(isDecided(gf1)).toBe(true);
      if (doubleGrandFinal && gfWinner === 'opponent2') {
        expect(isDecided(gf2)).toBe(true);
      } else if (gf2) {
        expect(gf2.status).toBe(MatchStatus.Archived);
        expect(isDecided(gf2)).toBe(false);
      }

      // Every team except the champion lost exactly twice (or once, via the GF).
      const losses = new Map<number, number>();
      for (const m of snap.matches.filter(isDecided)) {
        const loser = (m.opponent1 as { result: string }).result === 'loss' ? m.opponent1 : m.opponent2;
        losses.set(opponentId(loser)!, (losses.get(opponentId(loser)!) ?? 0) + 1);
      }
      expect([...losses.values()].every((n) => n <= 2)).toBe(true);
      // Everyone but the two finalists went out with two losses.
      expect([...losses.values()].filter((n) => n === 2).length).toBeGreaterThanOrEqual(snap.participants.length - 2);
      expect(played).toBeGreaterThan(teams);
    });
  });
});

describe('completeMatch', () => {
  it('rejects a tie and leaves the match untouched', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const match = playableMatches(await getBracketSnapshot(tx, event.eventId))[0];
      await expect(completeMatch(tx, event.eventId, match.id)).rejects.toThrow(
        'Match cannot be completed with a tied score. Continue scoring in overtime.'
      );
      expect((await getMatch(tx, match.id)).status).toBe(match.status);
    });
  });

  it('rejects completing a match twice', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const match = playableMatches(await getBracketSnapshot(tx, event.eventId))[0];
      await playMatch(tx, event.eventId, match.id, 'opponent2');
      await expect(completeMatch(tx, event.eventId, match.id)).rejects.toThrow('Match is already completed');
    });
  });

  it('completes with manual final scores (no frames)', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const match = playableMatches(await getBracketSnapshot(tx, event.eventId))[0];
      await completeMatch(tx, event.eventId, match.id, { team1Score: 10, team2Score: 12 });
      const stored = await getMatch(tx, match.id);
      expect(stored.status).toBe(MatchStatus.Completed);
      expect(stored.opponent2).toMatchObject({ score: 12, result: 'win' });
      expect(stored.opponent1).toMatchObject({ score: 10, result: 'loss' });
    });
  });

  it('releases the lane and hands it to the next ready match in the same transaction', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 8, laneCount: 1 });
      let snap = await getBracketSnapshot(tx, event.eventId);
      const onLane = snap.matches.find((m) => m.lane_id != null)!;
      const lane = onLane.lane_id;

      await playMatch(tx, event.eventId, onLane.id, 'opponent1');

      snap = await getBracketSnapshot(tx, event.eventId);
      expect(snap.matches.find((m) => m.id === onLane.id)!.lane_id).toBeNull();
      const next = snap.matches.find((m) => m.lane_id === lane)!;
      expect(next).toBeDefined();
      expect(next.id).not.toBe(onLane.id);
      expectLaneInvariants(snap);
    });
  });
});

describe('completed score corrections', () => {
  it('rejects a completed match without a recorded winner', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4 });
      const match = playableMatches(await getBracketSnapshot(tx, event.eventId))[0];
      await tx.update(bracket_match).set({ status: MatchStatus.Completed }).where(eq(bracket_match.id, match.id));

      await expect(correctMatchScores(event.eventId, match.id, 2, 1)).rejects.toThrow(
        'This match has no recorded winner to correct. Use "Reset match" to replay it.'
      );
    });
  });

  it('allows a same-winner correction and rejects a winner flip without changing the match', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4 });
      const match = playableMatches(await getBracketSnapshot(tx, event.eventId))[0];
      await playMatch(tx, event.eventId, match.id, 'opponent1');

      await correctMatchScores(event.eventId, match.id, 20, 15);
      expect(await getMatch(tx, match.id)).toMatchObject({
        opponent1: expect.objectContaining({ score: 20, result: 'win' }),
        opponent2: expect.objectContaining({ score: 15, result: 'loss' }),
      });

      await expect(correctMatchScores(event.eventId, match.id, 10, 25)).rejects.toThrow(
        'This correction changes the winner'
      );
      expect(await getMatch(tx, match.id)).toMatchObject({
        opponent1: expect.objectContaining({ score: 20, result: 'win' }),
        opponent2: expect.objectContaining({ score: 15, result: 'loss' }),
      });
    });
  });

  it.each([
    { winner: 'opponent1' as const, disturbedStatus: MatchStatus.Ready, expectedStatus: MatchStatus.Archived },
    { winner: 'opponent2' as const, disturbedStatus: MatchStatus.Archived, expectedStatus: MatchStatus.Ready },
  ])('reconciles the grand-final reset match when $winner remains the winner', async ({
    winner,
    disturbedStatus,
    expectedStatus,
  }) => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 2 });

      let snap = await getBracketSnapshot(tx, event.eventId);
      for (;;) {
        const gf1 = gfMatches(snap).find((match) => match.round_number === 1);
        if (gf1 && playableMatches(snap).some((match) => match.id === gf1.id)) {
          await playMatch(tx, event.eventId, gf1.id, winner);
          break;
        }
        const next = playableMatches(snap).find((match) => match.group_number !== GRAND_FINAL_GROUP);
        if (!next) throw new Error('Grand final did not become playable');
        await playMatch(tx, event.eventId, next.id, 'opponent1');
        snap = await getBracketSnapshot(tx, event.eventId);
      }

      snap = await getBracketSnapshot(tx, event.eventId);
      const [gf1, gf2] = gfMatches(snap);
      await tx.update(bracket_match).set({ status: disturbedStatus }).where(eq(bracket_match.id, gf2.id));
      const opponent1 = gf1.opponent1 as { score?: number };
      const opponent2 = gf1.opponent2 as { score?: number };
      await correctMatchScores(
        event.eventId,
        gf1.id,
        opponent1.score ?? (winner === 'opponent1' ? 2 : 1),
        opponent2.score ?? (winner === 'opponent2' ? 2 : 1)
      );
      expect((await getMatch(tx, gf2.id)).status).toBe(expectedStatus);
    });
  });
});

describe('public completion regulation-frame guard', () => {
  it('rejects completion at 3/5 and allows it once all players have 5/5', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4, bracketFrameCount: 5 });
      const match = playableMatches(await getBracketSnapshot(tx, event.eventId))[0];
      await scoreMatch(tx, event.eventId, match.id, 'opponent1', 3);
      await expect(
        completeMatch(tx, event.eventId, match.id, undefined, { requireRegulationFrames: true })
      ).rejects.toThrow('All players must be scored for frames 1–5 before completing the match');

      await scoreMatch(tx, event.eventId, match.id, 'opponent1', 5);
      await completeMatch(tx, event.eventId, match.id, undefined, { requireRegulationFrames: true });
      expect((await getMatch(tx, match.id)).status).toBe(MatchStatus.Completed);
    });
  });

  it('allows a partial overtime frame after complete regulation scoring when it breaks the tie', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4, bracketFrameCount: 5, bonusPointEnabled: false });
      const match = playableMatches(await getBracketSnapshot(tx, event.eventId))[0];
      const team1 = await getParticipantPlayers(tx, event.eventId, opponentId(match.opponent1)!);
      const team2 = await getParticipantPlayers(tx, event.eventId, opponentId(match.opponent2)!);
      for (let frameNumber = 1; frameNumber <= 5; frameNumber++) {
        await recordFrameScores(tx, {
          eventId: event.eventId,
          matchId: match.id,
          frameNumber,
          scorer: 'public',
          scores: [...team1, ...team2].map((event_player_id) => ({ event_player_id, putts_made: 1 })),
        });
      }
      await recordFrameScores(tx, {
        eventId: event.eventId,
        matchId: match.id,
        frameNumber: 6,
        scorer: 'public',
        scores: [{ event_player_id: team1[0], putts_made: 1 }],
      });

      await completeMatch(tx, event.eventId, match.id, undefined, { requireRegulationFrames: true });
      expect((await getMatch(tx, match.id)).status).toBe(MatchStatus.Completed);
    });
  });

  it('still rejects a tie after every regulation frame is complete', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4, bracketFrameCount: 5, bonusPointEnabled: false });
      const match = playableMatches(await getBracketSnapshot(tx, event.eventId))[0];
      const team1 = await getParticipantPlayers(tx, event.eventId, opponentId(match.opponent1)!);
      const team2 = await getParticipantPlayers(tx, event.eventId, opponentId(match.opponent2)!);
      for (let frameNumber = 1; frameNumber <= 5; frameNumber++) {
        await recordFrameScores(tx, {
          eventId: event.eventId,
          matchId: match.id,
          frameNumber,
          scorer: 'public',
          scores: [...team1, ...team2].map((event_player_id) => ({ event_player_id, putts_made: 1 })),
        });
      }
      await expect(
        completeMatch(tx, event.eventId, match.id, undefined, { requireRegulationFrames: true })
      ).rejects.toThrow('Match cannot be completed with a tied score');
    });
  });
});

describe('storage handles every opponent shape found in production', () => {
  it('advances into slots holding {id:null}, id-only opponents and stray position keys', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 5, laneCount: 2 }); // 8-slot bracket with 3 BYEs
      const snap = await getBracketSnapshot(tx, event.eventId);

      // SQL NULL (BYE) and {"id": null} shapes are present after creation
      expect(snap.matches.some((m) => m.opponent1 === null || m.opponent2 === null)).toBe(true);
      expect(snap.matches.some((m) => (m.opponent1 as { id: null } | null)?.id === null)).toBe(true);

      await playOutBracket(tx, event.eventId, () => 'opponent2');
      const finished = await getBracketSnapshot(tx, event.eventId);
      expectFinished(finished);
      expectLaneInvariants(finished);
    });
  });
});

async function completedWithDownstream(ex: Executor, eventId: string) {
  // Play WB round 1 completely, then one WB round 2 match.
  let snap = await getBracketSnapshot(ex, eventId);
  for (const m of snap.matches.filter((x) => x.group_number === 1 && x.round_number === 1)) {
    if (opponentId(m.opponent1) != null && opponentId(m.opponent2) != null) {
      await playMatch(ex, eventId, m.id, 'opponent1');
    }
  }
  snap = await getBracketSnapshot(ex, eventId);
  const r1 = snap.matches.filter((x) => x.group_number === 1 && x.round_number === 1);
  return { snap, r1 };
}

describe('resetMatchResult', () => {
  it('rewrites downstream slots, deletes frames, releases lanes, and replays to the same result', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 8, laneCount: 2 });
      const { r1 } = await completedWithDownstream(tx, event.eventId);
      const target = r1[0];
      expect(target.status).toBe(MatchStatus.Completed);
      const before = await getBracketSnapshot(tx, event.eventId);

      const { resetMatchIds } = await resetMatchResult(event.eventId, target.id);
      expect(resetMatchIds[0]).toBe(target.id);
      expect(resetMatchIds.length).toBeGreaterThan(1);

      let snap = await getBracketSnapshot(tx, event.eventId);
      const reset = snap.matches.find((m) => m.id === target.id)!;
      expect(reset.status).toBe(MatchStatus.Ready);
      expect(reset.opponent1).toEqual(expect.objectContaining({ id: opponentId(target.opponent1) }));
      expect((reset.opponent1 as { result?: string }).result).toBeUndefined();
      const frames = await tx.select().from(match_frames).where(inArray(match_frames.bracket_match_id, resetMatchIds));
      expect(frames).toHaveLength(0);
      expectLaneInvariants(snap);

      // The winner no longer sits in the downstream slots
      for (const id of resetMatchIds.slice(1)) {
        const m = snap.matches.find((x) => x.id === id)!;
        const ids = [opponentId(m.opponent1), opponentId(m.opponent2)];
        const winner = opponentId(target.opponent1);
        const loser = opponentId(target.opponent2);
        expect(ids).not.toContain(winner);
        expect(ids).not.toContain(loser);
      }

      // Replay with the same winner → same downstream state
      await scoreMatch(tx, event.eventId, target.id, 'opponent1');
      await completeMatch(tx, event.eventId, target.id);
      snap = await getBracketSnapshot(tx, event.eventId);
      for (const id of resetMatchIds.slice(1)) {
        const was = before.matches.find((m) => m.id === id)!;
        const now = snap.matches.find((m) => m.id === id)!;
        expect([opponentId(now.opponent1), opponentId(now.opponent2)]).toEqual([
          opponentId(was.opponent1),
          opponentId(was.opponent2),
        ]);
      }
      await expectScoresMatchFrames(tx, event.eventId, target.id);
      expectLaneInvariants(snap);
    });
  });

  it('archives the reset match again when the first grand final is reset', async () => {
    await withRollback(db, async (tx) => {
      mockAdmin.tx = tx;
      const event = await seedBracket(tx, { teams: 4, laneCount: 2 });
      await playOutBracket(tx, event.eventId, (m) =>
        m.group_number === GRAND_FINAL_GROUP && m.round_number === 1 ? 'opponent2' : 'opponent1'
      );
      let snap = await getBracketSnapshot(tx, event.eventId);
      const [gf1, gf2] = gfMatches(snap);
      expect(isDecided(gf2)).toBe(true);

      await resetMatchResult(event.eventId, gf1.id);
      snap = await getBracketSnapshot(tx, event.eventId);
      expect(snap.matches.find((m) => m.id === gf1.id)!.status).toBe(MatchStatus.Ready);
      expect(snap.matches.find((m) => m.id === gf2.id)!.status).toBe(MatchStatus.Archived);
      expectLaneInvariants(snap);
    });
  });
});
