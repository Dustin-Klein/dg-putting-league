import { eq } from 'drizzle-orm';
import { bracket_match, frame_results, match_frames } from '@/lib/db/schema';
import { recordFrameScores } from '@/lib/services/scoring/score-submission';
import { completeMatch } from '@/lib/services/scoring/match-completion';
import { syncMatchScores } from '@/lib/services/scoring/match-scores';
import { MatchStatus } from '@/lib/types/bracket';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, getParticipantPlayers, seedBracket } from './db/seed';
import { expectScoresMatchFrames, getMatch, opponentId, playMatch, playableMatches, scoreMatch } from './db/play';
import type { Executor } from '@/lib/db/tx';

const db = createTestDb();
afterAll(() => closeDb(db));

async function firstReadyMatch(ex: Executor, eventId: string) {
  const snap = await getBracketSnapshot(ex, eventId);
  const match = playableMatches(snap)[0];
  const team1 = await getParticipantPlayers(ex, eventId, opponentId(match.opponent1)!);
  const team2 = await getParticipantPlayers(ex, eventId, opponentId(match.opponent2)!);
  return { match, team1, team2 };
}

describe('recordFrameScores', () => {
  it('records a frame, starts the match and keeps the stored score in sync', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const { match, team1, team2 } = await firstReadyMatch(tx, event.eventId);
      expect(match.status).toBe(MatchStatus.Ready);

      const result = await recordFrameScores(tx, {
        eventId: event.eventId,
        matchId: match.id,
        frameNumber: 1,
        scorer: 'public',
        scores: [
          { event_player_id: team1[0], putts_made: 3 },
          { event_player_id: team1[1], putts_made: 2 },
          { event_player_id: team2[0], putts_made: 0 },
          { event_player_id: team2[1], putts_made: 1 },
        ],
      });

      expect(result.status).toBe(MatchStatus.Running);
      const stored = await getMatch(tx, match.id);
      expect(stored.status).toBe(MatchStatus.Running);
      // bonus point: 3 putts = 4 points
      expect((stored.opponent1 as { score: number }).score).toBe(6);
      expect((stored.opponent2 as { score: number }).score).toBe(1);
      await expectScoresMatchFrames(tx, event.eventId, match.id);

      const rows = await tx.select().from(frame_results).where(eq(frame_results.bracket_match_id, match.id));
      expect(rows.map((r) => r.order_in_frame).sort()).toEqual([1, 2, 3, 4]);
    });
  });

  it('keeps a manual final score and blocks later frame edits while its override is set', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const { match, team1 } = await firstReadyMatch(tx, event.eventId);

      await completeMatch(tx, event.eventId, match.id, { team1Score: 14, team2Score: 9 });
      const stored = await getMatch(tx, match.id);
      expect(stored).toMatchObject({ score_override_1: 14, score_override_2: 9 });
      expect(stored.opponent1).toMatchObject({ score: 14, result: 'win' });
      expect(stored.opponent2).toMatchObject({ score: 9, result: 'loss' });

      await expect(recordFrameScores(tx, {
        eventId: event.eventId,
        matchId: match.id,
        frameNumber: 1,
        scorer: 'admin',
        scores: [{ event_player_id: team1[0], putts_made: 3 }],
      })).rejects.toThrow('This match has a manually entered final score. Clear it first.');

      expect((await getMatch(tx, match.id)).opponent1).toMatchObject({ score: 14, result: 'win' });
    });
  });

  it('removes stale score keys when a match has opponents but no frames or override', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const { match } = await firstReadyMatch(tx, event.eventId);
      await tx.update(bracket_match).set({
        opponent1: { ...(match.opponent1 as object), score: 3 },
        opponent2: { ...(match.opponent2 as object), score: 2 },
      }).where(eq(bracket_match.id, match.id));

      await syncMatchScores(tx, match.id);
      const stored = await getMatch(tx, match.id);
      expect(stored.opponent1).not.toHaveProperty('score');
      expect(stored.opponent2).not.toHaveProperty('score');
    });
  });

  it('keeps order_in_frame when a player is re-scored and appends new players', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const { match, team1, team2 } = await firstReadyMatch(tx, event.eventId);
      const base = { eventId: event.eventId, matchId: match.id, frameNumber: 1, scorer: 'public' as const };

      await recordFrameScores(tx, { ...base, scores: [{ event_player_id: team1[0], putts_made: 1 }] });
      await recordFrameScores(tx, { ...base, scores: [{ event_player_id: team2[0], putts_made: 2 }] });
      await recordFrameScores(tx, { ...base, scores: [{ event_player_id: team1[0], putts_made: 3 }] });

      const rows = await tx.select().from(frame_results).where(eq(frame_results.bracket_match_id, match.id));
      const byPlayer = new Map(rows.map((r) => [r.event_player_id, r]));
      expect(byPlayer.get(team1[0])).toMatchObject({ order_in_frame: 1, putts_made: 3, points_earned: 4 });
      expect(byPlayer.get(team2[0])).toMatchObject({ order_in_frame: 2, putts_made: 2 });
      await expectScoresMatchFrames(tx, event.eventId, match.id);
    });
  });

  it('marks frames beyond the regulation count as overtime', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4, bracketFrameCount: 5 });
      const { match, team1 } = await firstReadyMatch(tx, event.eventId);
      for (let frameNumber = 1; frameNumber <= 6; frameNumber++) {
        await recordFrameScores(tx, {
          eventId: event.eventId,
          matchId: match.id,
          frameNumber,
          scorer: 'public',
          scores: [{ event_player_id: team1[0], putts_made: 2 }],
        });
      }
      const frames = await tx.select().from(match_frames).where(eq(match_frames.bracket_match_id, match.id));
      const frame = frames.find((row) => row.frame_number === 6);
      expect(frame).toMatchObject({ frame_number: 6, is_overtime: true });
    });
  });

  it('rejects a frame gap but allows re-scoring an existing frame', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const { match, team1 } = await firstReadyMatch(tx, event.eventId);
      const input = {
        eventId: event.eventId,
        matchId: match.id,
        scorer: 'public' as const,
        scores: [{ event_player_id: team1[0], putts_made: 1 }],
      };

      await expect(recordFrameScores(tx, { ...input, frameNumber: 2 })).rejects.toThrow(
        'Frames must be scored in order; frame 1 has not been started'
      );
      await recordFrameScores(tx, { ...input, frameNumber: 1 });
      await recordFrameScores(tx, { ...input, frameNumber: 1, scores: [{ ...input.scores[0], putts_made: 2 }] });
      expect(await tx.select().from(match_frames).where(eq(match_frames.bracket_match_id, match.id))).toHaveLength(1);
    });
  });

  it('rejects filling past a historical gap but allows re-scoring frames beyond it', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const { match, team1 } = await firstReadyMatch(tx, event.eventId);
      const input = {
        eventId: event.eventId,
        matchId: match.id,
        scorer: 'admin' as const,
        scores: [{ event_player_id: team1[0], putts_made: 1 }],
      };
      await recordFrameScores(tx, { ...input, frameNumber: 1 });
      // Legacy data: frame 10 scored while 2–9 are missing.
      const [frame10] = await tx
        .insert(match_frames)
        .values({ bracket_match_id: match.id, frame_number: 10, is_overtime: true })
        .returning({ id: match_frames.id });
      await tx.insert(frame_results).values({
        match_frame_id: frame10.id,
        event_player_id: team1[0],
        bracket_match_id: match.id,
        putts_made: 1,
        points_earned: 1,
        order_in_frame: 1,
      });

      await expect(recordFrameScores(tx, { ...input, frameNumber: 9 })).rejects.toThrow(
        'Frames must be scored in order; frame 2 has not been started'
      );
      await recordFrameScores(tx, { ...input, frameNumber: 10, scores: [{ ...input.scores[0], putts_made: 2 }] });
      await recordFrameScores(tx, { ...input, frameNumber: 2 });
    });
  });

  it('ignores empty pre-created frames when enforcing frame order', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const { match, team1 } = await firstReadyMatch(tx, event.eventId);
      // An empty future frame, as the create-only frame route can make.
      await tx.insert(match_frames).values({ bracket_match_id: match.id, frame_number: 10, is_overtime: true });

      await expect(
        recordFrameScores(tx, {
          eventId: event.eventId,
          matchId: match.id,
          frameNumber: 9,
          scorer: 'admin',
          scores: [{ event_player_id: team1[0], putts_made: 1 }],
        })
      ).rejects.toThrow('Frames must be scored in order; frame 1 has not been started');
    });
  });

  it('rejects a player who is not in the match', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const { match, team1, team2 } = await firstReadyMatch(tx, event.eventId);
      const outsider = event.eventPlayerIds.find((id) => !team1.includes(id) && !team2.includes(id))!;
      await expect(
        recordFrameScores(tx, {
          eventId: event.eventId,
          matchId: match.id,
          frameNumber: 1,
          scorer: 'public',
          scores: [{ event_player_id: outsider, putts_made: 2 }],
        })
      ).rejects.toThrow('Player is not in this match');
      // nothing written, not even the frame
      expect(await tx.select().from(match_frames).where(eq(match_frames.bracket_match_id, match.id))).toHaveLength(0);
    });
  });

  it('rejects invalid input', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const { match, team1 } = await firstReadyMatch(tx, event.eventId);
      const base = { eventId: event.eventId, matchId: match.id, scorer: 'public' as const };
      const score = { event_player_id: team1[0], putts_made: 1 };

      await expect(recordFrameScores(tx, { ...base, frameNumber: 51, scores: [score] })).rejects.toThrow(
        'Frame number exceeds maximum allowed limit'
      );
      await expect(recordFrameScores(tx, { ...base, frameNumber: 1.5, scores: [score] })).rejects.toThrow(
        'Frame number must be a positive integer'
      );
      await expect(
        recordFrameScores(tx, { ...base, frameNumber: 1, scores: [{ ...score, putts_made: 4 }] })
      ).rejects.toThrow('Putts must be between 0 and 3');
      await expect(recordFrameScores(tx, { ...base, frameNumber: 1, scores: [score, score] })).rejects.toThrow(
        'Each player can only be scored once per frame'
      );
    });
  });

  it('rejects a match from another event', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const other = await seedBracket(tx, { teams: 4 });
      const { match, team1 } = await firstReadyMatch(tx, other.eventId);
      await expect(
        recordFrameScores(tx, {
          eventId: event.eventId,
          matchId: match.id,
          frameNumber: 1,
          scorer: 'public',
          scores: [{ event_player_id: team1[0], putts_made: 1 }],
        })
      ).rejects.toThrow('Match not found');
    });
  });

  it('rejects public scores on a completed match but lets an admin correct it', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const { match, team1 } = await firstReadyMatch(tx, event.eventId);
      await playMatch(tx, event.eventId, match.id, 'opponent1');
      expect((await getMatch(tx, match.id)).status).toBe(MatchStatus.Completed);

      const input = {
        eventId: event.eventId,
        matchId: match.id,
        frameNumber: 1,
        scores: [{ event_player_id: team1[0], putts_made: 2 }],
      };
      await expect(recordFrameScores(tx, { ...input, scorer: 'public' })).rejects.toThrow('Match is already completed');

      const result = await recordFrameScores(tx, { ...input, scorer: 'admin' });
      expect(result.status).toBe(MatchStatus.Completed);
      await expectScoresMatchFrames(tx, event.eventId, match.id);
    });
  });

  it('rolls back an admin frame edit that would flip a completed match winner', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4, bracketFrameCount: 1, bonusPointEnabled: false });
      const { match, team1, team2 } = await firstReadyMatch(tx, event.eventId);
      await scoreMatch(tx, event.eventId, match.id, 'opponent1', 1);
      await completeMatch(tx, event.eventId, match.id);

      const input = {
        eventId: event.eventId,
        matchId: match.id,
        frameNumber: 1,
        scorer: 'admin' as const,
      };
      await recordFrameScores(tx, {
        ...input,
        scores: [{ event_player_id: team1[0], putts_made: 2 }],
      });
      await recordFrameScores(tx, {
        ...input,
        scores: [{ event_player_id: team2[0], putts_made: 3 }],
      });
      await expect(
        recordFrameScores(tx, {
          ...input,
          scores: [{ event_player_id: team2[1], putts_made: 3 }],
        })
      ).rejects.toThrow('This correction changes the winner');

      const stored = await getMatch(tx, match.id);
      expect(stored.opponent1).toMatchObject({ score: 5, result: 'win' });
      expect(stored.opponent2).toMatchObject({ score: 4, result: 'loss' });
      const rows = await tx.select().from(frame_results).where(eq(frame_results.bracket_match_id, match.id));
      expect(rows.find((row) => row.event_player_id === team2[1])?.putts_made).toBe(1);
    });
  });

  it('rejects public scores on a match that is not in play yet', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const snap = await getBracketSnapshot(tx, event.eventId);
      const waiting = snap.matches.find((m) => m.status === MatchStatus.Locked || m.status === MatchStatus.Waiting)!;
      await expect(
        recordFrameScores(tx, {
          eventId: event.eventId,
          matchId: waiting.id,
          frameNumber: 1,
          scorer: 'public',
          scores: [],
        })
      ).rejects.toThrow('Match is not ready for scoring');
    });
  });
});
