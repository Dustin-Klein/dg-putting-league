import { eq } from 'drizzle-orm';
import { event_players, events, lanes, teams } from '@/lib/db/schema';
import { MatchStatus } from '@/lib/types/bracket';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { buildDeterministicPairings, getBracketSnapshot, seedBracket, seedEvent } from './db/seed';
import { startBracket } from '@/lib/services/event/event-service';

const db = createTestDb();
afterAll(() => closeDb(db));

describe('startBracket', () => {
  it('creates teams, lanes, bracket and initial lane assignments in one go', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 8, laneCount: 3 });
      const snap = await getBracketSnapshot(tx, event.eventId);

      const [row] = await tx.select({ status: events.status }).from(events).where(eq(events.id, event.eventId));
      expect(row.status).toBe('bracket');

      // participants are linked to teams in seed order, with matching names
      const teamRows = await tx.select().from(teams).where(eq(teams.event_id, event.eventId));
      expect(snap.participants).toHaveLength(8);
      for (const p of snap.participants) {
        const team = teamRows.find((t) => t.id === p.team_id);
        expect(team?.pool_combo).toBe(p.name);
      }

      const ready = snap.matches.filter((m) => m.status === MatchStatus.Ready);
      expect(ready).toHaveLength(4);
      expect(snap.matches.every((m) => m.event_id === event.eventId)).toBe(true);

      // 3 lanes, all occupied by the first three ready matches
      expect(snap.lanes).toHaveLength(3);
      expect(snap.lanes.every((l) => l.status === 'occupied')).toBe(true);
      expect(snap.matches.filter((m) => m.lane_id != null)).toHaveLength(3);
    });
  });

  it('rolls back everything when a step fails part-way', async () => {
    await withRollback(db, async (tx) => {
      // One team: pools, team, lanes and the status change are written, then bracket
      // creation fails ("At least 2 teams"). Nothing may be left behind.
      const event = await seedEvent(tx, { players: 2, laneCount: 2 });
      const { poolAssignments, teamPairings } = buildDeterministicPairings(event);

      await expect(startBracket(tx, event.eventId, poolAssignments, teamPairings)).rejects.toThrow(
        'At least 2 teams are required to create a bracket'
      );

      const [row] = await tx.select({ status: events.status }).from(events).where(eq(events.id, event.eventId));
      expect(row.status).toBe('pre-bracket');
      expect(await tx.select().from(teams).where(eq(teams.event_id, event.eventId))).toHaveLength(0);
      expect(await tx.select().from(lanes).where(eq(lanes.event_id, event.eventId))).toHaveLength(0);
      const entries = await tx.select().from(event_players).where(eq(event_players.event_id, event.eventId));
      expect(entries.every((e) => e.pool === null)).toBe(true);
    });
  });

  it('rejects players from outside the event', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedEvent(tx, { players: 4 });
      const { poolAssignments, teamPairings } = buildDeterministicPairings(event);
      const foreign = '00000000-0000-0000-0000-000000000000';
      teamPairings[1].members[1] = { eventPlayerId: foreign, role: 'B_pool' };
      await expect(startBracket(tx, event.eventId, poolAssignments, teamPairings)).rejects.toThrow(
        'Teams must be made of distinct players registered for this event'
      );
    });
  });

  it('refuses to start twice', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const { poolAssignments, teamPairings } = buildDeterministicPairings(event);
      await expect(startBracket(tx, event.eventId, poolAssignments, teamPairings)).rejects.toThrow(
        /must be in pre-bracket status/
      );
    });
  });
});
