import { eq } from 'drizzle-orm';
import { frame_results, match_frames } from '@/lib/db/schema';
import { recordFrameScores } from '@/lib/services/scoring/score-submission';
import { MatchStatus } from '@/lib/types/bracket';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, getParticipantPlayers, seedBracket } from './db/seed';
import { expectScoresMatchFrames, getMatch, opponentId, playMatch, playableMatches } from './db/play';
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
      await recordFrameScores(tx, {
        eventId: event.eventId,
        matchId: match.id,
        frameNumber: 6,
        scorer: 'public',
        scores: [{ event_player_id: team1[0], putts_made: 2 }],
      });
      const [frame] = await tx.select().from(match_frames).where(eq(match_frames.bracket_match_id, match.id));
      expect(frame).toMatchObject({ frame_number: 6, is_overtime: true });
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
