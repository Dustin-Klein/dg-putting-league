import { BracketsManager } from 'brackets-manager';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { Status } from 'brackets-model';
import {
  bracket_group,
  bracket_match,
  bracket_participant,
  bracket_round,
  bracket_stage,
  teams,
} from '@/lib/db/schema';
import type { Executor, Tx } from '@/lib/db/tx';
import { DrizzleBracketStorage } from '@/lib/repositories/bracket-storage.db';
import { createBracketTx } from '@/lib/services/bracket/bracket-service';
import { startBracket } from '@/lib/services/event/event-service';
import { closeDb, createCountingTestDb, createTestDb, withRollback } from './db/harness';
import { buildDeterministicPairings, seedEvent } from './db/seed';

const db = createTestDb();
// Statements startBracket sends, its savepoint included. The last two are the entry
// snapshot refresh (event context + entry states); a handicap event adds a few more
// for the league handicap lock and zone reads, none of them per player.
const START_BRACKET_STATEMENT_BUDGET = 26;

const counting = createCountingTestDb();
afterAll(async () => {
  await closeDb(db);
  await closeDb(counting.db);
});

/** The bracket creation this replaced: brackets-manager writing through to Postgres row by row. */
async function createBracketRowByRow(tx: Tx, eventId: string, doubleGrandFinal: boolean): Promise<void> {
  const teamRows = await tx.select().from(teams).where(eq(teams.event_id, eventId));
  const sortedTeams = [...teamRows].sort((a, b) => (a.seed || 0) - (b.seed || 0));
  let size = 2;
  while (size < sortedTeams.length) size *= 2;
  const seeding: (string | null)[] = sortedTeams.map((t) => t.pool_combo ?? `Team ${t.seed}`);
  while (seeding.length < size) seeding.push(null);

  await new BracketsManager(new DrizzleBracketStorage(tx, eventId)).create.stage({
    tournamentId: eventId as unknown as number,
    name: 'Double Elimination',
    type: 'double_elimination',
    seeding,
    settings: { grandFinal: doubleGrandFinal ? 'double' : 'simple', seedOrdering: ['inner_outer'], balanceByes: true },
  });

  const participants = await tx
    .select({ id: bracket_participant.id })
    .from(bracket_participant)
    .where(eq(bracket_participant.tournament_id, eventId))
    .orderBy(asc(bracket_participant.id));
  for (const [i, p] of participants.entries()) {
    if (!sortedTeams[i]) continue;
    await tx.update(bracket_participant).set({ team_id: sortedTeams[i].id }).where(eq(bracket_participant.id, p.id));
  }
  const [stage] = await tx.select({ id: bracket_stage.id }).from(bracket_stage).where(eq(bracket_stage.tournament_id, eventId));
  await tx
    .update(bracket_match)
    .set({ status: Status.Ready })
    .where(
      sql`${bracket_match.stage_id} = ${stage.id} and ${bracket_match.status} < ${Status.Ready}
        and ${bracket_match.opponent1}->>'id' is not null and ${bracket_match.opponent2}->>'id' is not null`
    );
}

/** The event's bracket with every id replaced by its rank within the event, so two events compare equal. */
async function canonicalBracket(ex: Executor, eventId: string) {
  const stages = await ex.select().from(bracket_stage).where(eq(bracket_stage.tournament_id, eventId)).orderBy(asc(bracket_stage.id));
  const stageIds = stages.map((s) => s.id);
  const groups = await ex.select().from(bracket_group).where(inArray(bracket_group.stage_id, stageIds)).orderBy(asc(bracket_group.id));
  const rounds = await ex.select().from(bracket_round).where(inArray(bracket_round.stage_id, stageIds)).orderBy(asc(bracket_round.id));
  const matches = await ex.select().from(bracket_match).where(inArray(bracket_match.stage_id, stageIds)).orderBy(asc(bracket_match.id));
  const participants = await ex
    .select()
    .from(bracket_participant)
    .where(eq(bracket_participant.tournament_id, eventId))
    .orderBy(asc(bracket_participant.id));
  const teamRows = await ex.select({ id: teams.id, seed: teams.seed }).from(teams).where(eq(teams.event_id, eventId));
  const seedOfTeam = new Map(teamRows.map((t) => [t.id, t.seed]));

  const rank = (ids: number[]) => new Map(ids.map((id, i) => [id, i]));
  const stageRank = rank(stageIds);
  const groupRank = rank(groups.map((g) => g.id));
  const roundRank = rank(rounds.map((r) => r.id));
  const participantRank = rank(participants.map((p) => p.id));
  const opponent = (value: unknown) => {
    if (value === null || typeof value !== 'object') return value;
    const o = value as { id?: number | null };
    return { ...o, id: o.id == null ? o.id : participantRank.get(o.id) };
  };

  return {
    stages: stages.map((s) => ({ name: s.name, type: s.type, number: s.number, settings: s.settings })),
    groups: groups.map((g) => ({ stage: stageRank.get(g.stage_id), number: g.number })),
    rounds: rounds.map((r) => ({ stage: stageRank.get(r.stage_id), group: groupRank.get(r.group_id), number: r.number })),
    participants: participants.map((p) => ({ name: p.name, teamSeed: p.team_id ? seedOfTeam.get(p.team_id) : null })),
    matches: matches.map((m) => ({
      stage: stageRank.get(m.stage_id),
      group: groupRank.get(m.group_id),
      round: roundRank.get(m.round_id),
      number: m.number,
      child_count: m.child_count,
      status: m.status,
      opponent1: opponent(m.opponent1),
      opponent2: opponent(m.opponent2),
      event_id: m.event_id === eventId,
    })),
  };
}

async function seedTeams(tx: Tx, teamCount: number, doubleGrandFinal: boolean): Promise<string> {
  const event = await seedEvent(tx, { players: 0, status: 'bracket', doubleGrandFinal });
  await tx.insert(teams).values(
    Array.from({ length: teamCount }, (_, i) => ({ event_id: event.eventId, seed: i + 1, pool_combo: `Team ${i + 1}` }))
  );
  return event.eventId;
}

describe('bracket creation', () => {
  const sizes = [2, 3, 5, 8, 16, 32, 64, 128];
  for (const doubleGrandFinal of [true, false]) {
    it.each(sizes)(`matches row-by-row creation for %i teams (${doubleGrandFinal ? 'double' : 'simple'} grand final)`, async (teamCount) => {
      await withRollback(db, async (tx) => {
        const reference = await seedTeams(tx, teamCount, doubleGrandFinal);
        const generated = await seedTeams(tx, teamCount, doubleGrandFinal);

        await createBracketRowByRow(tx, reference, doubleGrandFinal);
        await createBracketTx(tx, generated, doubleGrandFinal);

        const expected = await canonicalBracket(tx, reference);
        expect(expected.matches.length).toBeGreaterThan(0);
        expect(await canonicalBracket(tx, generated)).toEqual(expected);
      });
    });
  }

  it('refuses an event that already has bracket rows', async () => {
    await withRollback(db, async (tx) => {
      const eventId = await seedTeams(tx, 4, true);
      await tx.insert(bracket_participant).values({ tournament_id: eventId, name: 'Leftover' });
      await expect(createBracketTx(tx, eventId, true)).rejects.toThrow('Bracket has already been created');
    });
  });

  it.each([
    { label: '64 players in doubles', players: 64 },
    { label: '128 players in doubles', players: 128 },
  ])('starts a bracket for $label in a bounded number of statements', async ({ players }) => {
    await withRollback(counting.db, async (tx) => {
      const event = await seedEvent(tx, { players, laneCount: 8 });
      const { poolAssignments, teamPairings } = buildDeterministicPairings(event);

      const { total } = await counting.count(() => startBracket(tx, event.eventId, poolAssignments, teamPairings));

      // The same budget for 64 and 128 players (row-by-row creation took ~260 and ~520):
      // nothing here is per player, team, match or lane.
      expect(total).toBeLessThanOrEqual(START_BRACKET_STATEMENT_BUDGET);
    });
  });
});
