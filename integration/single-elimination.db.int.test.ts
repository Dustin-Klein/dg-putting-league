import { asc, eq } from 'drizzle-orm';
import { bracket_stage, event_placements, events, teams } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/tx';
import { updateEventSettingsTx } from '@/lib/services/event/event-service';
import { MatchStatus } from '@/lib/types/bracket';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, seedBracket } from './db/seed';
import { playMatch, playOutBracket, playableMatches, expectLaneInvariants } from './db/play';

const db = createTestDb();
afterAll(() => closeDb(db));

/** The better seed (lower participant id) always wins, so results are predictable. */
const higherSeedWins = (match: { opponent1: unknown; opponent2: unknown }) =>
  ((match.opponent1 as { id: number }).id < (match.opponent2 as { id: number }).id ? 'opponent1' : 'opponent2');

async function placementsBySeed(ex: Executor, eventId: string): Promise<Array<{ placement: number; seed: number | null }>> {
  return ex
    .select({ placement: event_placements.placement, seed: teams.seed })
    .from(event_placements)
    .innerJoin(teams, eq(teams.id, event_placements.team_id))
    .where(eq(event_placements.event_id, eventId))
    .orderBy(asc(event_placements.placement));
}

describe('single-elimination events', () => {
  it('creates a single-elimination stage with one group and no grand final', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 8, bracketFormat: 'single_elimination' });
      const [stage] = await tx.select({ type: bracket_stage.type }).from(bracket_stage)
        .where(eq(bracket_stage.tournament_id, event.eventId));
      expect(stage.type).toBe('single_elimination');

      const snapshot = await getBracketSnapshot(tx, event.eventId);
      expect(new Set(snapshot.matches.map((match) => match.group_number))).toEqual(new Set([1]));
      expect(snapshot.matches).toHaveLength(7);
    });
  });

  it('refuses completion until the final is decided, then places the champion first', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 8, bracketFormat: 'single_elimination', laneCount: 2 });

      // Play everything but the final.
      for (;;) {
        const snapshot = await getBracketSnapshot(tx, event.eventId);
        const next = playableMatches(snapshot).filter((match) => match.round_number < 3);
        if (next.length === 0) break;
        await playMatch(tx, event.eventId, next[0].id, higherSeedWins(next[0]));
        expectLaneInvariants(await getBracketSnapshot(tx, event.eventId));
      }
      await expect(updateEventSettingsTx(tx, event.eventId, { status: 'completed' }))
        .rejects.toMatchObject({ name: 'ConflictError' });

      await playOutBracket(tx, event.eventId, higherSeedWins);
      await updateEventSettingsTx(tx, event.eventId, { status: 'completed' });

      const [row] = await tx.select({ status: events.status }).from(events).where(eq(events.id, event.eventId));
      expect(row.status).toBe('completed');
      const placements = await placementsBySeed(tx, event.eventId);
      expect(placements.map((placement) => placement.placement)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(placements.slice(0, 2).map((placement) => placement.seed)).toEqual([1, 2]);
    });
  });

  it('plays the third-place match before the final and places its teams third and fourth', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, {
        teams: 4,
        bracketFormat: 'single_elimination',
        thirdPlaceMatch: true,
        laneCount: 1,
      });

      // Both semifinals.
      for (let i = 0; i < 2; i++) {
        const snapshot = await getBracketSnapshot(tx, event.eventId);
        const semi = playableMatches(snapshot).find((match) => match.group_number === 1 && match.round_number === 1)!;
        await playMatch(tx, event.eventId, semi.id, higherSeedWins(semi));
      }

      // With one lane, the queue gives it to the third-place match first.
      const afterSemis = await getBracketSnapshot(tx, event.eventId);
      const onLane = afterSemis.matches.filter((match) => match.lane_id != null);
      expect(onLane).toHaveLength(1);
      expect(onLane[0].group_number).toBe(2);

      await playMatch(tx, event.eventId, onLane[0].id, higherSeedWins(onLane[0]));
      const final = (await getBracketSnapshot(tx, event.eventId)).matches.find((match) => match.group_number === 1 && match.round_number === 2)!;
      // The final is decided, but the third-place match is part of the generated bracket.
      expect(final.status).toBe(MatchStatus.Ready);
      await playMatch(tx, event.eventId, final.id, higherSeedWins(final));

      await updateEventSettingsTx(tx, event.eventId, { status: 'completed' });
      const placements = await placementsBySeed(tx, event.eventId);
      expect(placements.map((placement) => placement.seed)).toEqual([1, 2, 3, 4]);
    });
  });

  it('requires the third-place match before completing', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4, bracketFormat: 'single_elimination', thirdPlaceMatch: true });
      for (;;) {
        const snapshot = await getBracketSnapshot(tx, event.eventId);
        const next = playableMatches(snapshot).filter((match) => match.group_number === 1);
        if (next.length === 0) break;
        await playMatch(tx, event.eventId, next[0].id, higherSeedWins(next[0]));
      }
      await expect(updateEventSettingsTx(tx, event.eventId, { status: 'completed' }))
        .rejects.toMatchObject({ name: 'ConflictError' });
    });
  });

  it('plays out an uneven single-elimination bracket with byes and a third-place match', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, {
        teams: 6,
        bracketFormat: 'single_elimination',
        thirdPlaceMatch: true,
        laneCount: 2,
      });
      await playOutBracket(tx, event.eventId, higherSeedWins);
      await updateEventSettingsTx(tx, event.eventId, { status: 'completed' });
      const placements = await placementsBySeed(tx, event.eventId);
      expect(placements).toHaveLength(6);
      expect(placements[0].seed).toBe(1);
    });
  });

  it('completes a three-team bracket whose third-place match is a bye', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 3, bracketFormat: 'single_elimination', thirdPlaceMatch: true });
      await playOutBracket(tx, event.eventId, higherSeedWins);
      await updateEventSettingsTx(tx, event.eventId, { status: 'completed' });
      const placements = await placementsBySeed(tx, event.eventId);
      expect(placements.map((placement) => placement.seed)).toEqual([1, 2, 3]);
    });
  });

  it('only changes the format before bracket play and rejects contradictory settings', async () => {
    await withRollback(db, async (tx) => {
      const started = await seedBracket(tx, { teams: 4 });
      await expect(updateEventSettingsTx(tx, started.eventId, { bracket_format: 'single_elimination' }))
        .rejects.toMatchObject({ name: 'BadRequestError' });

      const se = await seedBracket(tx, { teams: 4, bracketFormat: 'single_elimination' });
      await expect(updateEventSettingsTx(tx, se.eventId, { double_grand_final: true }))
        .rejects.toMatchObject({ name: 'BadRequestError' });
    });
  });
});
