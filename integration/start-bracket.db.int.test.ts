import { eq } from 'drizzle-orm';
import { event_players, events, lanes, players, team_members, teams } from '@/lib/db/schema';
import { MatchStatus } from '@/lib/types/bracket';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { buildDeterministicPairings, getBracketSnapshot, seedBracket, seedEvent } from './db/seed';
import { startBracket } from '@/lib/services/event/event-service';
import { STALE_PREVIEW_MESSAGE } from '@/lib/constants/event';

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
      teamPairings[1].members[1] = { eventPlayerId: foreign, slot: 2 };
      // Indistinguishable from a player removed since the preview, so it reads as a stale roster.
      await expect(startBracket(tx, event.eventId, poolAssignments, teamPairings)).rejects.toThrow(
        STALE_PREVIEW_MESSAGE
      );
    });
  });

  it('rejects a stale preview after a player is added', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedEvent(tx, { players: 4 });
      const { poolAssignments, teamPairings } = buildDeterministicPairings(event);
      const [player] = await tx.insert(players).values({ full_name: 'Late Player' }).returning({ id: players.id });
      await tx.insert(event_players).values({ event_id: event.eventId, player_id: player.id, payment_type: 'cash' });

      await expect(startBracket(tx, event.eventId, poolAssignments, teamPairings)).rejects.toMatchObject({
        name: 'ConflictError',
      });
    });
  });

  it('rejects a duplicate team member', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedEvent(tx, { players: 4 });
      const { poolAssignments, teamPairings } = buildDeterministicPairings(event);
      teamPairings[1].members[0] = { ...teamPairings[0].members[0] };
      await expect(startBracket(tx, event.eventId, poolAssignments, teamPairings)).rejects.toThrow(
        'more than one team'
      );
    });
  });

  it('accepts a manual swap and ignores client-supplied score fields', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedEvent(tx, { players: 4 });
      const canonical = buildDeterministicPairings(event);
      const suppliedPools = canonical.poolAssignments.map((assignment) => ({
        ...assignment,
        pfaScore: 999,
        scoringMethod: 'default' as const,
      }));
      const suppliedTeams = structuredClone(canonical.teamPairings);
      [suppliedTeams[0].members[1], suppliedTeams[1].members[1]] = [
        suppliedTeams[1].members[1],
        suppliedTeams[0].members[1],
      ];

      await startBracket(
        tx,
        event.eventId,
        suppliedPools,
        suppliedTeams,
        canonical.poolAssignments
      );

      const storedPlayers = await tx.select().from(event_players).where(eq(event_players.event_id, event.eventId));
      expect(storedPlayers.every((playerRow) => playerRow.pfa_score !== '999.00')).toBe(true);
      const storedMembers = await tx
        .select({ teamId: team_members.team_id, eventPlayerId: team_members.event_player_id })
        .from(team_members)
        .innerJoin(teams, eq(teams.id, team_members.team_id))
        .where(eq(teams.event_id, event.eventId));
      expect(storedMembers).toHaveLength(4);
      // The swapped pairs were stored as submitted.
      const partnerOf = (id: string) => {
        const teamId = storedMembers.find((m) => m.eventPlayerId === id)!.teamId;
        return storedMembers.find((m) => m.teamId === teamId && m.eventPlayerId !== id)!.eventPlayerId;
      };
      for (const team of suppliedTeams) {
        expect(partnerOf(team.members[0].eventPlayerId)).toBe(team.members[1].eventPlayerId);
      }
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
