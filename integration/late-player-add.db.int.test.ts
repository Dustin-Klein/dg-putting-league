import { eq, inArray } from 'drizzle-orm';
import {
  bracket_stage,
  event_players,
  events,
  frame_results,
  lanes,
  players,
  team_member_substitutions,
  team_members,
  teams,
} from '@/lib/db/schema';
import type { Executor } from '@/lib/db/tx';
import { buildMatchNumbers } from '@/lib/brackets/match-numbering';
import { fillByeDb, getOpenByesDb } from '@/lib/services/bracket/fill-bye';
import { reopenRegistrationDb } from '@/lib/services/event/reopen-registration';
import { substituteTeamMemberDb } from '@/lib/services/team/substitution';
import { recordFrameScores } from '@/lib/services/scoring/score-submission';
import { MatchStatus } from '@/lib/types/bracket';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { cleanupLeague, getBracketSnapshot, getParticipantPlayers, seedBracket, type BracketSnapshot } from './db/seed';
import { expectLaneInvariants, opponentId, playMatch, playOutBracket, playableMatches } from './db/play';

const db = createTestDb();
afterAll(() => closeDb(db));

const higherSeedWins = (match: { opponent1: unknown; opponent2: unknown }) =>
  ((match.opponent1 as { id: number }).id < (match.opponent2 as { id: number }).id ? 'opponent1' : 'opponent2');

async function newPlayers(ex: Executor, count: number): Promise<string[]> {
  const rows = await ex
    .insert(players)
    .values(Array.from({ length: count }, (_, i) => ({ full_name: `Late ${i + 1} ${Math.random().toString(36).slice(2, 8)}` })))
    .returning({ id: players.id });
  return rows.map((row) => row.id);
}

function numbersOf(snapshot: BracketSnapshot) {
  const groups = [...new Map(snapshot.matches.map((m) => [m.group_id, { id: m.group_id, number: m.group_number }])).values()];
  const rounds = [...new Map(snapshot.matches.map((m) => [m.round_id, { id: m.round_id, group_id: m.group_id, number: m.round_number }])).values()];
  return buildMatchNumbers(groups, rounds, snapshot.matches);
}

async function teamOfParticipant(ex: Executor, snapshot: BracketSnapshot, participantId: number) {
  const teamId = snapshot.participants.find((p) => p.id === participantId)!.team_id!;
  const members = await ex.select().from(team_members).where(eq(team_members.team_id, teamId));
  return { teamId, members: members.sort((a, b) => a.slot - b.slot) };
}

describe('substituting a player during bracket play', () => {
  it('puts the incoming player in the slot with their own entry and drops an outgoing entry with no frames', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 6, laneCount: 2 });
      const snapshot = await getBracketSnapshot(tx, event.eventId);
      const waiting = snapshot.matches.find((m) => m.status === MatchStatus.Ready && m.lane_id == null)
        ?? snapshot.matches.find((m) => m.status === MatchStatus.Ready)!;
      const { teamId, members } = await teamOfParticipant(tx, snapshot, opponentId(waiting.opponent1)!);
      const [incoming] = await newPlayers(tx, 1);
      const outgoing = members[1];
      const [outEntry] = await tx.select().from(event_players).where(eq(event_players.id, outgoing.event_player_id));

      const result = await substituteTeamMemberDb(tx, event.eventId, teamId, null, {
        outEventPlayerId: outgoing.event_player_id,
        playerId: incoming,
        paymentType: 'cash',
        reason: 'missed_registration',
      });

      expect(result.outEntryRemoved).toBe(true);
      const after = await tx.select().from(team_members).where(eq(team_members.team_id, teamId));
      expect(after.map((m) => m.event_player_id).sort()).toEqual([members[0].event_player_id, result.inEventPlayerId].sort());
      expect(after.find((m) => m.event_player_id === result.inEventPlayerId)!.slot).toBe(outgoing.slot);
      const [inEntry] = await tx.select().from(event_players).where(eq(event_players.id, result.inEventPlayerId));
      expect(inEntry).toMatchObject({ player_id: incoming, pool: outEntry.pool, payment_type: 'cash', zone: null });
      expect(await tx.select().from(event_players).where(eq(event_players.id, outgoing.event_player_id))).toHaveLength(0);
      const [team] = await tx.select({ name: teams.pool_combo }).from(teams).where(eq(teams.id, teamId));
      const [incomingName] = await tx.select({ name: players.full_name }).from(players).where(eq(players.id, incoming));
      expect(team.name).toContain(incomingName.name);
      const [record] = await tx.select().from(team_member_substitutions).where(eq(team_member_substitutions.team_id, teamId));
      expect(record).toMatchObject({ out_player_id: outEntry.player_id, out_event_player_id: null, reason: 'missed_registration' });
    });
  });

  it('keeps the outgoing entry once it has frames, and refuses while the team is playing', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4, laneCount: 2 });
      const snapshot = await getBracketSnapshot(tx, event.eventId);
      const [first] = playableMatches(snapshot);
      const participant = opponentId(first.opponent1)!;
      const { teamId, members } = await teamOfParticipant(tx, snapshot, participant);
      const [incoming] = await newPlayers(tx, 1);

      // One frame in: the match is running.
      const team1 = await getParticipantPlayers(tx, event.eventId, participant);
      const team2 = await getParticipantPlayers(tx, event.eventId, opponentId(first.opponent2)!);
      await recordFrameScores(tx, {
        eventId: event.eventId,
        matchId: first.id,
        frameNumber: 1,
        scorer: 'public',
        scores: [...team1, ...team2].map((id) => ({ event_player_id: id, putts_made: 2 })),
      });
      await expect(substituteTeamMemberDb(tx, event.eventId, teamId, null, {
        outEventPlayerId: members[0].event_player_id,
        playerId: incoming,
        paymentType: null,
        reason: 'injury',
      })).rejects.toMatchObject({ name: 'ConflictError' });

      await playMatch(tx, event.eventId, first.id, 'opponent1');
      const result = await substituteTeamMemberDb(tx, event.eventId, teamId, null, {
        outEventPlayerId: members[0].event_player_id,
        playerId: incoming,
        paymentType: null,
        reason: 'left_early',
      });
      expect(result.outEntryRemoved).toBe(false);
      expect(await tx.select().from(event_players).where(eq(event_players.id, members[0].event_player_id))).toHaveLength(1);

      // The player who left can't come back in.
      const [outEntry] = await tx.select().from(event_players).where(eq(event_players.id, members[0].event_player_id));
      await expect(substituteTeamMemberDb(tx, event.eventId, teamId, null, {
        outEventPlayerId: result.inEventPlayerId,
        playerId: outEntry.player_id,
        paymentType: null,
        reason: 'wrong_player',
      })).rejects.toMatchObject({ name: 'BadRequestError' });

      // The incoming player's next match is scored with their entry.
      await playOutBracket(tx, event.eventId, higherSeedWins);
      expect(await getParticipantPlayers(tx, event.eventId, participant)).toContain(result.inEventPlayerId);
    });
  });
});

describe('filling a Round 1 bye', () => {
  it('enters a new team against the bye team, keeps match ids and numbers, and plays out', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 7, laneCount: 2 });
      const before = await getBracketSnapshot(tx, event.eventId);
      const numbersBefore = numbersOf(before);

      const summary = await getOpenByesDb(tx, event.eventId);
      expect(summary.byes).toHaveLength(1);
      expect(summary.byes[0]).toMatchObject({ open: true, seed: 1 });
      expect(summary.defaultByeMatchId).toBe(summary.byes[0].byeMatchId);

      const result = await fillByeDb(tx, event.eventId, {
        byeMatchId: summary.defaultByeMatchId!,
        playerIds: await newPlayers(tx, 2),
        payments: ['cash', 'electronic'],
      });
      expect(result.seed).toBe(8);

      const after = await getBracketSnapshot(tx, event.eventId);
      expect(after.matches.map((m) => m.id).sort()).toEqual(before.matches.map((m) => m.id).sort());
      const filled = after.matches.find((m) => m.id === summary.defaultByeMatchId)!;
      expect(opponentId(filled.opponent1)).not.toBeNull();
      expect(opponentId(filled.opponent2)).not.toBeNull();
      expect(filled.status).toBe(MatchStatus.Ready);

      expect(numbersOf(after).size).toBe(numbersBefore.size + 2);
      expect((await getOpenByesDb(tx, event.eventId)).byes).toHaveLength(0);

      const [team] = await tx.select().from(teams).where(eq(teams.id, result.teamId));
      expect(team.seed).toBe(8);
      expectLaneInvariants(after);
      await playOutBracket(tx, event.eventId, higherSeedWins);
      expectLaneInvariants(await getBracketSnapshot(tx, event.eventId));
    });
  });

  it('closes the bye once the bye team has played its next match', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 7, laneCount: 3 });
      const [bye] = (await getOpenByesDb(tx, event.eventId)).byes;
      // Play Round 1, then the bye team's Round 2 match.
      for (let i = 0; i < 4; i++) {
        const snapshot = await getBracketSnapshot(tx, event.eventId);
        const next = playableMatches(snapshot).sort((a, b) => a.id - b.id)[0];
        if (!next) break;
        await playMatch(tx, event.eventId, next.id, higherSeedWins(next));
      }
      const summary = await getOpenByesDb(tx, event.eventId);
      expect(summary.byes.find((b) => b.byeMatchId === bye.byeMatchId)?.open).toBe(false);
      await expect(fillByeDb(tx, event.eventId, {
        byeMatchId: bye.byeMatchId,
        playerIds: await newPlayers(tx, 2),
        payments: [null, null],
      })).rejects.toMatchObject({ name: 'ConflictError' });
    });
  });
});

describe('reopening registration', () => {
  it('goes back to pre-bracket with players kept, the bracket and teams removed and the teams remembered', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4, laneCount: 2 });
      const result = await reopenRegistrationDb(tx, event.eventId, { keepTeams: true });
      expect(result).toEqual({ keptTeams: 4, discardedMatches: 0 });

      const [row] = await tx.select({ status: events.status, draft: events.reopened_team_draft }).from(events)
        .where(eq(events.id, event.eventId));
      expect(row.status).toBe('pre-bracket');
      expect(row.draft).toHaveLength(4);
      expect(await tx.select().from(bracket_stage).where(eq(bracket_stage.tournament_id, event.eventId))).toHaveLength(0);
      expect(await tx.select().from(teams).where(eq(teams.event_id, event.eventId))).toHaveLength(0);
      const entries = await tx.select().from(event_players).where(eq(event_players.event_id, event.eventId));
      expect(entries).toHaveLength(8);
      expect(entries.every((e) => e.pool === null && e.payment_type === 'cash')).toBe(true);
      const laneRows = await tx.select().from(lanes).where(eq(lanes.event_id, event.eventId));
      expect(laneRows.every((lane) => lane.status === 'idle')).toBe(true);
    });
  });

  it('once a frame is scored, refuses unless told to delete the scores, then deletes them', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4, laneCount: 2 });
      const [first] = playableMatches(await getBracketSnapshot(tx, event.eventId));
      const team1 = await getParticipantPlayers(tx, event.eventId, opponentId(first.opponent1)!);
      const team2 = await getParticipantPlayers(tx, event.eventId, opponentId(first.opponent2)!);
      await recordFrameScores(tx, {
        eventId: event.eventId,
        matchId: first.id,
        frameNumber: 1,
        scorer: 'public',
        scores: [...team1, ...team2].map((id) => ({ event_player_id: id, putts_made: 1 })),
      });
      await expect(reopenRegistrationDb(tx, event.eventId, { keepTeams: false }))
        .rejects.toMatchObject({ name: 'ConflictError' });
      // A finished match too, so the count covers both.
      const [second] = playableMatches(await getBracketSnapshot(tx, event.eventId)).filter((m) => m.id !== first.id);
      await playMatch(tx, event.eventId, second.id, higherSeedWins(second));

      const result = await reopenRegistrationDb(tx, event.eventId, { keepTeams: true, discardScores: true });
      expect(result).toEqual({ keptTeams: 4, discardedMatches: 2 });
      const [row] = await tx.select({ status: events.status }).from(events).where(eq(events.id, event.eventId));
      expect(row.status).toBe('pre-bracket');
      expect(await tx.select().from(frame_results).where(inArray(frame_results.bracket_match_id, [first.id, second.id]))).toHaveLength(0);
      const laneRows = await tx.select().from(lanes).where(eq(lanes.event_id, event.eventId));
      expect(laneRows.every((lane) => lane.status === 'idle')).toBe(true);
    });
  });
});

describe('race: fill a bye vs. the first frame of the match it changes', () => {
  const seeded: Array<{ leagueId: string; playerIds: string[] }> = [];
  afterAll(async () => {
    for (const event of seeded) await cleanupLeague(db, event);
  });

  it('never lets both the fill and a frame on the changed match succeed (10x)', async () => {
    const outcomes = { fill: 0, frame: 0 };
    for (let i = 0; i < 10; i++) {
      const event = await seedBracket(db, { teams: 7, laneCount: 4 });
      const late = await newPlayers(db, 2);
      seeded.push({ leagueId: event.leagueId, playerIds: [...event.playerIds, ...late] });
      const [bye] = (await getOpenByesDb(db, event.eventId)).byes;

      // Finish Round 1 so the bye team's next match is Ready.
      for (;;) {
        const roundOne = playableMatches(await getBracketSnapshot(db, event.eventId))
          .filter((m) => m.group_number === 1 && m.round_number === 1);
        if (roundOne.length === 0) break;
        await playMatch(db, event.eventId, roundOne[0].id, higherSeedWins(roundOne[0]));
      }
      const next = (await getBracketSnapshot(db, event.eventId)).matches
        .find((m) => m.group_number === 1 && m.round_number === 2 && m.status === MatchStatus.Ready &&
          [opponentId(m.opponent1), opponentId(m.opponent2)].includes(bye.participantId))!;
      const team1 = await getParticipantPlayers(db, event.eventId, opponentId(next.opponent1)!);
      const team2 = await getParticipantPlayers(db, event.eventId, opponentId(next.opponent2)!);

      const [fill, frame] = await Promise.allSettled([
        fillByeDb(db, event.eventId, { byeMatchId: bye.byeMatchId, playerIds: late, payments: ['cash', 'cash'] }),
        recordFrameScores(db, {
          eventId: event.eventId,
          matchId: next.id,
          frameNumber: 1,
          scorer: 'public',
          scores: [...team1, ...team2].map((id) => ({ event_player_id: id, putts_made: 2 })),
        }),
      ]);
      expect(fill.status === 'fulfilled' && frame.status === 'fulfilled').toBe(false);
      if (fill.status === 'fulfilled') outcomes.fill++;
      if (frame.status === 'fulfilled') outcomes.frame++;
      expectLaneInvariants(await getBracketSnapshot(db, event.eventId));
    }
    expect(outcomes.fill + outcomes.frame).toBe(10);
  });
});
