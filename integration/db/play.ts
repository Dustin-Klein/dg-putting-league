/**
 * Helpers that play bracket matches through the real services.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { bracket_match, frame_results } from '@/lib/db/schema';
import { recordFrameScores } from '@/lib/services/scoring/score-submission';
import { completeMatch } from '@/lib/services/scoring/match-completion';
import { MatchStatus } from '@/lib/types/bracket';
import { getBracketSnapshot, getParticipantPlayers, type BracketSnapshot, type Opponent } from './seed';

export function opponentId(opponent: unknown): number | null {
  return (opponent as Opponent)?.id ?? null;
}

export async function getMatch(ex: Executor, matchId: number) {
  const [row] = await ex.select().from(bracket_match).where(eq(bracket_match.id, matchId));
  return row;
}

/**
 * Score `frames` regulation frames so the chosen side wins (3 putts vs 1 every frame).
 */
export async function scoreMatch(
  ex: Executor,
  eventId: string,
  matchId: number,
  winner: 'opponent1' | 'opponent2',
  frames = 5
): Promise<void> {
  const match = await getMatch(ex, matchId);
  const team1 = await getParticipantPlayers(ex, eventId, opponentId(match.opponent1)!);
  const team2 = await getParticipantPlayers(ex, eventId, opponentId(match.opponent2)!);
  const [winners, losers] = winner === 'opponent1' ? [team1, team2] : [team2, team1];

  for (let frame = 1; frame <= frames; frame++) {
    await recordFrameScores(ex, {
      eventId,
      matchId,
      frameNumber: frame,
      scorer: 'public',
      scores: [
        ...winners.map((id) => ({ event_player_id: id, putts_made: 3 })),
        ...losers.map((id) => ({ event_player_id: id, putts_made: 1 })),
      ],
    });
  }
}

/**
 * Score and complete a match, with the given side winning.
 */
export async function playMatch(
  ex: Executor,
  eventId: string,
  matchId: number,
  winner: 'opponent1' | 'opponent2'
): Promise<void> {
  await scoreMatch(ex, eventId, matchId, winner);
  await completeMatch(ex, eventId, matchId);
}

export function playableMatches(snap: BracketSnapshot) {
  return snap.matches.filter(
    (m) =>
      (m.status === MatchStatus.Ready || m.status === MatchStatus.Running) &&
      opponentId(m.opponent1) != null &&
      opponentId(m.opponent2) != null
  );
}

/**
 * Play every match until none is playable. `pickWinner` decides each match.
 * Returns the number of matches played.
 */
export async function playOutBracket(
  ex: Executor,
  eventId: string,
  pickWinner: (match: BracketSnapshot['matches'][number]) => 'opponent1' | 'opponent2'
): Promise<number> {
  let played = 0;
  for (;;) {
    const snap = await getBracketSnapshot(ex, eventId);
    const next = playableMatches(snap);
    if (next.length === 0) return played;
    // Matches on lanes first, like the venue would
    next.sort((a, b) => Number(b.lane_id != null) - Number(a.lane_id != null) || a.id - b.id);
    await playMatch(ex, eventId, next[0].id, pickWinner(next[0]));
    played++;
    if (played > 200) throw new Error('Bracket did not finish');
  }
}

/**
 * Lane invariants: an occupied lane holds exactly one open match; an idle or
 * maintenance lane holds none; no finished match holds a lane.
 */
export function expectLaneInvariants(snap: BracketSnapshot): void {
  const open = new Set<number>([MatchStatus.Waiting, MatchStatus.Ready, MatchStatus.Running]);
  for (const lane of snap.lanes) {
    const onLane = snap.matches.filter((m) => m.lane_id === lane.id);
    if (lane.status === 'occupied') {
      expect({ lane: lane.label, matches: onLane.length }).toEqual({ lane: lane.label, matches: 1 });
      expect(open.has(onLane[0].status)).toBe(true);
    } else {
      expect({ lane: lane.label, matches: onLane.length }).toEqual({ lane: lane.label, matches: 0 });
    }
  }
}

/**
 * Stored opponent scores equal the sum of the match's frame points, per team.
 */
export async function expectScoresMatchFrames(ex: Executor, eventId: string, matchId: number): Promise<void> {
  const match = await getMatch(ex, matchId);
  for (const slot of ['opponent1', 'opponent2'] as const) {
    const participant = opponentId(match[slot]);
    if (participant == null) continue;
    const players = await getParticipantPlayers(ex, eventId, participant);
    const rows = await ex
      .select({ points: frame_results.points_earned })
      .from(frame_results)
      .where(and(eq(frame_results.bracket_match_id, matchId), inArray(frame_results.event_player_id, players)));
    const sum = rows.reduce((total, r) => total + r.points, 0);
    expect((match[slot] as Opponent)?.score ?? 0).toBe(sum);
  }
}
