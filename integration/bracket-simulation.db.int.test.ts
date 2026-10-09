import { eq, inArray } from 'drizzle-orm';
import { bracket_match, frame_results } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/tx';
import { resetMatchResult } from '@/lib/services/bracket/bracket-service';
import { updateEventSettingsTx } from '@/lib/services/event/event-service';
import { setLaneIdle, setLaneMaintenance } from '@/lib/services/lane/lane-service';
import { completeMatch } from '@/lib/services/scoring/match-completion';
import { correctMatchScores } from '@/lib/services/scoring/match-scoring';
import { recordFrameScores } from '@/lib/services/scoring/score-submission';
import { MatchStatus } from '@/lib/types/bracket';
import { closeDb, createTestDb, withRollback } from './db/harness';
import {
  getBracketSnapshot,
  getParticipantPlayers,
  seedBracket,
  type BracketSnapshot,
} from './db/seed';
import { getMatch, opponentId } from './db/play';

const mockAdmin: { tx?: Executor } = {};

// Admin-facing services authenticate through this barrel. Give them the current
// rollback transaction, as the other bracket integration tests do.
jest.mock('@/lib/services/event', () => ({
  requireEventAdmin: async () => ({ pg: mockAdmin.tx, supabase: null, user: { id: null } }),
}));
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
jest.mock('@/lib/repositories/event-repository.db', () => {
  const actual = jest.requireActual<typeof import('@/lib/repositories/event-repository.db')>(
    '@/lib/repositories/event-repository.db'
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
jest.mock('@/lib/repositories/lane-repository', () => {
  const actual = jest.requireActual<typeof import('@/lib/repositories/lane-repository')>(
    '@/lib/repositories/lane-repository'
  );
  return {
    ...actual,
    getLaneById: jest.fn().mockResolvedValue({ id: 'unused', label: 'unused', status: 'idle' }),
  };
});

const db = createTestDb();
afterAll(() => closeDb(db));

const GRAND_FINAL_GROUP = 3;
const LOSERS_BRACKET_GROUP = 2;
const REGULATION_FRAMES = 5;
const FINISHED_STATUSES = new Set<number>([MatchStatus.Completed, MatchStatus.Archived]);

type MatchRow = BracketSnapshot['matches'][number];
type Side = 'opponent1' | 'opponent2';

interface ScoredOpponent {
  id?: number | null;
  score?: number;
  result?: string;
}

const participantPlayersByEvent = new Map<string, Map<number, string[]>>();

// Small deterministic PRNG so a failing tournament can be replayed by seed.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(random: () => number, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function isFinished(match: MatchRow): boolean {
  return FINISHED_STATUSES.has(match.status);
}

function scoredOpponent(opponent: unknown): ScoredOpponent | null {
  return opponent as ScoredOpponent | null;
}

async function participantPlayerMap(
  ex: Executor,
  eventId: string,
  snapshot: BracketSnapshot
): Promise<Map<number, string[]>> {
  const cached = participantPlayersByEvent.get(eventId);
  if (cached) return cached;

  const players = new Map<number, string[]>();
  for (const participant of snapshot.participants) {
    players.set(participant.id, await getParticipantPlayers(ex, eventId, participant.id));
  }
  participantPlayersByEvent.set(eventId, players);
  return players;
}

/** Assert the structural, scoring, lane, and elimination invariants after every mutation. */
async function assertInvariants(ex: Executor, eventId: string): Promise<void> {
  const snapshot = await getBracketSnapshot(ex, eventId);
  const participantPlayers = await participantPlayerMap(ex, eventId, snapshot);
  const participantByPlayer = new Map<string, number>();
  for (const [participantId, players] of participantPlayers) {
    for (const player of players) participantByPlayer.set(player, participantId);
  }

  const matchIds = snapshot.matches.map((match) => match.id);
  const results = matchIds.length === 0
    ? []
    : await ex
        .select({
          matchId: frame_results.bracket_match_id,
          eventPlayerId: frame_results.event_player_id,
          points: frame_results.points_earned,
        })
        .from(frame_results)
        .where(inArray(frame_results.bracket_match_id, matchIds));
  const frameTotals = new Map<string, { count: number; points: number }>();
  for (const result of results) {
    if (result.matchId == null) continue;
    const participantId = participantByPlayer.get(result.eventPlayerId);
    if (participantId == null) continue;
    const key = `${result.matchId}:${participantId}`;
    const total = frameTotals.get(key) ?? { count: 0, points: 0 };
    total.count++;
    total.points += result.points;
    frameTotals.set(key, total);
  }

  const openMatchesByParticipant = new Map<number, number[]>();
  const losses = new Map<number, number>();

  for (const match of snapshot.matches) {
    const opponent1 = scoredOpponent(match.opponent1);
    const opponent2 = scoredOpponent(match.opponent2);
    const participantIds = [opponent1?.id, opponent2?.id].filter(
      (id): id is number => id != null
    );

    expect({ matchId: match.id, participantCount: participantIds.length }).toEqual({
      matchId: match.id,
      participantCount: new Set(participantIds).size,
    });
    expect(participantIds.length).toBeLessThanOrEqual(2);

    // A BYE (one slot SQL NULL) stays Waiting with the advancing team marked 'win';
    // it isn't a match anyone plays.
    const isBye = match.opponent1 === null || match.opponent2 === null;
    if (!isFinished(match) && !isBye) {
      for (const participantId of participantIds) {
        const openMatchIds = openMatchesByParticipant.get(participantId) ?? [];
        openMatchIds.push(match.id);
        openMatchesByParticipant.set(participantId, openMatchIds);
      }
    }

    const hasResult = opponent1?.result != null || opponent2?.result != null;
    if (isFinished(match) && participantIds.length === 2 && hasResult) {
      expect({ matchId: match.id, results: [opponent1?.result, opponent2?.result] }).toEqual({
        matchId: match.id,
        results: expect.arrayContaining(['win', 'loss']),
      });
      expect(typeof opponent1?.score).toBe('number');
      expect(typeof opponent2?.score).toBe('number');
      expect({ matchId: match.id, scores: [opponent1?.score, opponent2?.score] }).not.toEqual({
        matchId: match.id,
        scores: [opponent1?.score, opponent1?.score],
      });
      const winnerScore = opponent1?.result === 'win' ? opponent1.score : opponent2?.score;
      const loserScore = opponent1?.result === 'loss' ? opponent1.score : opponent2?.score;
      expect(winnerScore).toBeGreaterThan(loserScore as number);

      const loserId = opponent1?.result === 'loss' ? opponent1.id : opponent2?.id;
      if (loserId != null) losses.set(loserId, (losses.get(loserId) ?? 0) + 1);
    }

    for (const [slot, opponent, override] of [
      ['opponent1', opponent1, match.score_override_1],
      ['opponent2', opponent2, match.score_override_2],
    ] as const) {
      if (opponent?.id == null) continue;
      const frameTotal = frameTotals.get(`${match.id}:${opponent.id}`);
      const expectedScore = override ?? (frameTotal && frameTotal.count > 0 ? frameTotal.points : undefined);
      expect({ matchId: match.id, slot, score: opponent.score }).toEqual({
        matchId: match.id,
        slot,
        score: expectedScore,
      });
    }
  }

  for (const [participantId, matchIdsForParticipant] of openMatchesByParticipant) {
    expect({ participantId, openMatchIds: matchIdsForParticipant }).toEqual({
      participantId,
      openMatchIds: [matchIdsForParticipant[0]],
    });
  }

  for (const lane of snapshot.lanes) {
    const allReferences = snapshot.matches.filter((match) => match.lane_id === lane.id);
    const openReferences = allReferences.filter((match) => !isFinished(match));
    expect(openReferences.length).toBeLessThanOrEqual(1);
    expect({ lane: lane.label, occupied: lane.status === 'occupied' }).toEqual({
      lane: lane.label,
      occupied: openReferences.length === 1,
    });
    expect({ lane: lane.label, referencedMatches: allReferences.map((match) => match.id) }).toEqual({
      lane: lane.label,
      referencedMatches: openReferences.map((match) => match.id),
    });
    if (lane.maintenance_pending) {
      expect({ lane: lane.label, status: lane.status }).toEqual({
        lane: lane.label,
        status: 'occupied',
      });
      expect({ lane: lane.label, pendingOpenMatchCount: openReferences.length }).toEqual({
        lane: lane.label,
        pendingOpenMatchCount: 1,
      });
    }
  }

  expect([...losses.entries()].filter(([, count]) => count > 2)).toEqual([]);
  for (const [participantId, count] of losses) {
    if (count === 2) {
      expect({ participantId, openMatches: openMatchesByParticipant.get(participantId) ?? [] }).toEqual({
        participantId,
        openMatches: [],
      });
    }
  }
}

function playableMatches(snapshot: BracketSnapshot): MatchRow[] {
  const lanesExhausted = snapshot.lanes.every((lane) => lane.status !== 'idle');
  return snapshot.matches.filter((match) => {
    const ready = match.status === MatchStatus.Ready || match.status === MatchStatus.Running;
    const hasOpponents = opponentId(match.opponent1) != null && opponentId(match.opponent2) != null;
    return ready && hasOpponents && (match.lane_id != null || lanesExhausted);
  });
}

async function scoreRandomMatch(
  ex: Executor,
  eventId: string,
  match: MatchRow,
  random: () => number,
  forcedWinner?: Side
): Promise<Side> {
  const team1 = await getParticipantPlayers(ex, eventId, opponentId(match.opponent1)!);
  const team2 = await getParticipantPlayers(ex, eventId, opponentId(match.opponent2)!);

  for (let frameNumber = 1; frameNumber <= REGULATION_FRAMES; frameNumber++) {
    await recordFrameScores(ex, {
      eventId,
      matchId: match.id,
      frameNumber,
      scorer: 'public',
      scores: [
        ...team1.map((event_player_id) => ({
          event_player_id,
          putts_made: forcedWinner === 'opponent2' ? randomInt(random, 0, 1) : randomInt(random, 0, 3),
        })),
        ...team2.map((event_player_id) => ({
          event_player_id,
          putts_made: forcedWinner === 'opponent2' ? randomInt(random, 2, 3) : randomInt(random, 0, 3),
        })),
      ],
    });
    await assertInvariants(ex, eventId);
  }

  let stored = await getMatch(ex, match.id);
  let team1Score = scoredOpponent(stored.opponent1)?.score ?? 0;
  let team2Score = scoredOpponent(stored.opponent2)?.score ?? 0;
  let overtimeFrame = REGULATION_FRAMES + 1;
  while (team1Score === team2Score) {
    const allPlayers = [...team1, ...team2];
    const event_player_id = allPlayers[randomInt(random, 0, allPlayers.length - 1)];
    await recordFrameScores(ex, {
      eventId,
      matchId: match.id,
      frameNumber: overtimeFrame,
      scorer: 'public',
      // A single positive result deliberately exercises partial sudden-death overtime.
      scores: [{ event_player_id, putts_made: randomInt(random, 1, 3) }],
    });
    await assertInvariants(ex, eventId);
    overtimeFrame++;
    stored = await getMatch(ex, match.id);
    team1Score = scoredOpponent(stored.opponent1)?.score ?? 0;
    team2Score = scoredOpponent(stored.opponent2)?.score ?? 0;
  }

  const winner = team1Score > team2Score ? 'opponent1' : 'opponent2';
  if (forcedWinner) expect(winner).toBe(forcedWinner);
  return winner;
}

function isDecided(match: MatchRow | undefined): boolean {
  if (!match || !isFinished(match)) return false;
  const opponent1 = scoredOpponent(match.opponent1);
  const opponent2 = scoredOpponent(match.opponent2);
  return opponent1?.id != null && opponent2?.id != null && opponent1.result != null;
}

async function exerciseWinnerCorrections(ex: Executor, eventId: string, matchId: number): Promise<void> {
  const before = await getMatch(ex, matchId);
  const opponent1Won = scoredOpponent(before.opponent1)?.result === 'win';
  const sameWinnerScores = opponent1Won ? [50, 25] as const : [25, 50] as const;
  const flippedScores = opponent1Won ? [25, 50] as const : [50, 25] as const;

  await expect(correctMatchScores(eventId, matchId, flippedScores[0], flippedScores[1])).rejects.toThrow(
    'This correction changes the winner'
  );
  expect(await getMatch(ex, matchId)).toEqual(before);
  await assertInvariants(ex, eventId);

  await correctMatchScores(eventId, matchId, sameWinnerScores[0], sameWinnerScores[1]);
  expect(await getMatch(ex, matchId)).toMatchObject({
    score_override_1: sameWinnerScores[0],
    score_override_2: sameWinnerScores[1],
  });
  await assertInvariants(ex, eventId);
}

interface Scenario {
  teams: 8 | 12 | 16;
  doubleGrandFinal: boolean;
  seed: number;
  forceGrandFinalReset?: boolean;
}

const scenarios: Scenario[] = [
  { teams: 8, doubleGrandFinal: true, seed: 0x8d01, forceGrandFinalReset: true },
  { teams: 8, doubleGrandFinal: false, seed: 0x8d02 },
  { teams: 12, doubleGrandFinal: true, seed: 0x12d01 },
  { teams: 12, doubleGrandFinal: false, seed: 0x12d02 },
  { teams: 16, doubleGrandFinal: true, seed: 0x16d01 },
  { teams: 16, doubleGrandFinal: false, seed: 0x16d02 },
];

describe.each(scenarios)(
  'permanent bracket simulation: $teams teams, GF reset $doubleGrandFinal, seed $seed',
  ({ teams, doubleGrandFinal, seed, forceGrandFinalReset }) => {
    it('preserves bracket invariants through scoring, corrections, reset, toggles, and lane maintenance', async () => {
      await withRollback(db, async (tx) => {
        mockAdmin.tx = tx;
        const event = await seedBracket(tx, { teams, laneCount: 3, doubleGrandFinal });
        const random = mulberry32(seed);
        await assertInvariants(tx, event.eventId);

        // Exercise both transactional GF toggle paths while leaving the scenario's
        // configured behavior unchanged for the actual tournament.
        await updateEventSettingsTx(tx, event.eventId, { double_grand_final: !doubleGrandFinal });
        await assertInvariants(tx, event.eventId);
        await updateEventSettingsTx(tx, event.eventId, { double_grand_final: doubleGrandFinal });
        await assertInvariants(tx, event.eventId);

        // Remove and restore an active lane through the real maintenance service.
        let snapshot = await getBracketSnapshot(tx, event.eventId);
        const occupiedLane = snapshot.lanes.find((lane) => lane.status === 'occupied');
        if (!occupiedLane) throw new Error('Seeded bracket did not occupy a lane');
        const occupiedMatch = snapshot.matches.find((match) => match.lane_id === occupiedLane.id);
        if (!occupiedMatch) throw new Error('Occupied lane did not have a match');
        await tx.update(bracket_match)
          .set({ status: MatchStatus.Running })
          .where(eq(bracket_match.id, occupiedMatch.id));
        await setLaneMaintenance(event.eventId, occupiedLane.id, 'after_match');
        await assertInvariants(tx, event.eventId);
        snapshot = await getBracketSnapshot(tx, event.eventId);
        expect(snapshot.matches.find((match) => match.id === occupiedMatch.id)?.lane_id)
          .toBe(occupiedLane.id);
        await setLaneIdle(event.eventId, occupiedLane.id);
        await assertInvariants(tx, event.eventId);

        let corrected = false;
        let resetLosersMatch = false;
        let playedMatches = 0;
        let forcedResetMatchPlayed = false;

        for (;;) {
          snapshot = await getBracketSnapshot(tx, event.eventId);
          const playable = playableMatches(snapshot);
          if (playable.length === 0) break;
          const match = playable[randomInt(random, 0, playable.length - 1)];
          const forceThisMatch =
            forceGrandFinalReset === true &&
            match.group_number === GRAND_FINAL_GROUP &&
            match.round_number === 1;
          const winner = await scoreRandomMatch(
            tx,
            event.eventId,
            match,
            random,
            forceThisMatch ? 'opponent2' : undefined
          );
          if (forceThisMatch) forcedResetMatchPlayed = true;

          await completeMatch(tx, event.eventId, match.id);
          playedMatches++;
          await assertInvariants(tx, event.eventId);

          if (!corrected) {
            await exerciseWinnerCorrections(tx, event.eventId, match.id);
            corrected = true;
          }

          if (!resetLosersMatch && match.group_number === LOSERS_BRACKET_GROUP) {
            await resetMatchResult(event.eventId, match.id);
            resetLosersMatch = true;
            await assertInvariants(tx, event.eventId);
          }

          if (playedMatches > teams * 5) {
            throw new Error(`Bracket did not finish for seed ${seed}`);
          }

          // The selected outcome is intentionally random except for the one forced GF1.
          expect(winner === 'opponent1' || winner === 'opponent2').toBe(true);
        }

        expect(corrected).toBe(true);
        expect(resetLosersMatch).toBe(true);
        if (forceGrandFinalReset) expect(forcedResetMatchPlayed).toBe(true);

        snapshot = await getBracketSnapshot(tx, event.eventId);
        await assertInvariants(tx, event.eventId);
        const gf1 = snapshot.matches.find(
          (match) => match.group_number === GRAND_FINAL_GROUP && match.round_number === 1
        );
        const gf2 = snapshot.matches.find(
          (match) => match.group_number === GRAND_FINAL_GROUP && match.round_number === 2
        );
        expect(isDecided(gf1)).toBe(true);
        const resetWasNeeded =
          doubleGrandFinal && scoredOpponent(gf1?.opponent2)?.result === 'win';
        if (resetWasNeeded) expect(isDecided(gf2)).toBe(true);
        expect(
          snapshot.matches.filter(
            (match) => match.status === MatchStatus.Ready || match.status === MatchStatus.Running
          )
        ).toEqual([]);

        participantPlayersByEvent.delete(event.eventId);
      });
    });
  }
);
