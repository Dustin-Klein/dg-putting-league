import { asc, eq } from 'drizzle-orm';
import { event_placements, event_players, events, players, team_members, teams } from '@/lib/db/schema';
import type { Executor, Tx } from '@/lib/db/tx';
import { STALE_PREVIEW_MESSAGE } from '@/lib/constants/event';
import {
  getEventWithPlayers,
  previewTeams,
  transitionEventToBracket,
  updateEventSettingsTx,
} from '@/lib/services/event/event-service';
import type { TeamAssignment } from '@/lib/types/event';
import type { TeamPairing } from '@/lib/types/team';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, seedEvent, type SeededEvent } from './db/seed';
import { expectScoresMatchFrames, playOutBracket } from './db/play';

// The transition authorizes through these; hand them the rollback transaction.
const mockAdmin: { tx?: Executor } = {};
jest.mock('@/lib/services/auth', () => ({
  ...jest.requireActual('@/lib/services/auth'),
  authorizeEventAdmin: async () => ({ pg: mockAdmin.tx, user: { id: null }, event: {} }),
  authorizeEventView: async () => ({ pg: mockAdmin.tx, user: null, isAdmin: true, event: {} }),
}));
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

const db = createTestDb();
afterAll(() => closeDb(db));

async function seedFormat(
  tx: Executor,
  playerCount: number,
  teamSize: number,
  teamAssignment: TeamAssignment
): Promise<SeededEvent> {
  mockAdmin.tx = tx;
  const event = await seedEvent(tx, { players: playerCount, laneCount: 2 });
  await tx.update(events).set({ team_size: teamSize, team_assignment: teamAssignment }).where(eq(events.id, event.eventId));
  return event;
}

async function storedTeams(tx: Executor, eventId: string) {
  const rows = await tx
    .select({ teamId: teams.id, seed: teams.seed, eventPlayerId: team_members.event_player_id, slot: team_members.slot, role: team_members.role })
    .from(teams)
    .innerJoin(team_members, eq(team_members.team_id, teams.id))
    .where(eq(teams.event_id, eventId))
    .orderBy(asc(teams.seed), asc(team_members.slot));
  const byTeam = new Map<string, typeof rows>();
  for (const row of rows) byTeam.set(row.teamId, [...(byTeam.get(row.teamId) ?? []), row]);
  return [...byTeam.values()];
}

async function storedEntries(tx: Executor, eventId: string) {
  return tx.select().from(event_players).where(eq(event_players.event_id, eventId));
}

async function completeEvent(tx: Tx, eventId: string) {
  const played = await playOutBracket(tx, eventId, () => 'opponent1');
  await updateEventSettingsTx(tx, eventId, { status: 'completed' });
  return played;
}

describe('team formats end to end', () => {
  it('runs a singles event: teams of one, bracket, scoring, placements', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedFormat(tx, 5, 1, 'random_pairing');

      const preview = await previewTeams(event.eventId);
      expect(preview.teamPairings).toHaveLength(5);
      expect(preview.players.every((player) => player.pool === null)).toBe(true);

      await transitionEventToBracket(event.eventId, await getEventWithPlayers(event.eventId));

      const stored = await storedTeams(tx, event.eventId);
      expect(stored).toHaveLength(5);
      expect(stored.every((members) => members.length === 1 && members[0].slot === 1 && members[0].role === null)).toBe(true);
      expect(new Set(stored.map((members) => members[0].eventPlayerId))).toEqual(new Set(event.eventPlayerIds));
      const entries = await storedEntries(tx, event.eventId);
      expect(entries.every((entry) => entry.pool === null && entry.scoring_method !== null)).toBe(true);

      const snap = await getBracketSnapshot(tx, event.eventId);
      expect(snap.participants).toHaveLength(5);
      expect(snap.participants.map((p) => p.name).sort()).toEqual([...event.playerNames].sort());

      expect(await completeEvent(tx, event.eventId)).toBeGreaterThan(0);
      for (const match of (await getBracketSnapshot(tx, event.eventId)).matches) {
        await expectScoresMatchFrames(tx, event.eventId, match.id);
      }
      const placements = await tx.select().from(event_placements).where(eq(event_placements.event_id, event.eventId));
      expect(placements).toHaveLength(5);
      expect(placements.filter((p) => p.placement === 1)).toHaveLength(1);
      const [row] = await tx.select({ status: events.status }).from(events).where(eq(events.id, event.eventId));
      expect(row.status).toBe('completed');
    });
  });

  it('keeps the organizer’s exact manual doubles pairings and leaves pools unset', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedFormat(tx, 8, 2, 'manual');
      const ids = event.eventPlayerIds;

      const preview = await previewTeams(event.eventId);
      expect(preview.teamPairings).toEqual([]);
      expect(preview.players).toHaveLength(8);

      // Pair first with last, and put the later player in slot 1.
      const pairings = [0, 1, 2, 3].map((i) => ({
        seed: 99,
        poolCombo: 'forged',
        combinedScore: 1000,
        members: [
          { eventPlayerId: ids[7 - i], slot: 1 },
          { eventPlayerId: ids[i], slot: 2 },
        ],
      }));
      await transitionEventToBracket(event.eventId, await getEventWithPlayers(event.eventId), undefined, pairings);

      const stored = await storedTeams(tx, event.eventId);
      expect(stored).toHaveLength(4);
      const asPairs = stored.map((members) => members.map((m) => [m.slot, m.eventPlayerId, m.role]));
      for (const pairing of pairings) {
        expect(asPairs).toContainEqual(pairing.members.map((m) => [m.slot, m.eventPlayerId, null]));
      }
      const teamRows = await tx.select().from(teams).where(eq(teams.event_id, event.eventId));
      expect(teamRows.every((team) => team.pool_combo !== 'forged' && team.seed !== 99)).toBe(true);

      const entries = await storedEntries(tx, event.eventId);
      expect(entries.every((entry) => entry.pool === null)).toBe(true);

      await completeEvent(tx, event.eventId);
      const placements = await tx.select().from(event_placements).where(eq(event_placements.event_id, event.eventId));
      expect(placements).toHaveLength(4);
    });
  });

  it.each([
    ['added', async (tx: Executor, event: SeededEvent) => {
      const [player] = await tx.insert(players).values({ full_name: 'Late Player' }).returning({ id: players.id });
      await tx.insert(event_players).values({ event_id: event.eventId, player_id: player.id, payment_type: 'cash' });
    }],
    ['removed', async (tx: Executor, event: SeededEvent) => {
      await tx.delete(event_players).where(eq(event_players.id, event.eventPlayerIds[3]));
    }],
  ])('rejects a manual submission after a player is %s', async (_change, changeRoster) => {
    await withRollback(db, async (tx) => {
      const event = await seedFormat(tx, 4, 2, 'manual');
      const snapshot = await getEventWithPlayers(event.eventId);
      const pairings: TeamPairing[] = [
        { seed: 0, poolCombo: '', combinedScore: 0, members: [{ eventPlayerId: event.eventPlayerIds[0], slot: 1 }, { eventPlayerId: event.eventPlayerIds[1], slot: 2 }] },
        { seed: 0, poolCombo: '', combinedScore: 0, members: [{ eventPlayerId: event.eventPlayerIds[2], slot: 1 }, { eventPlayerId: event.eventPlayerIds[3], slot: 2 }] },
      ];

      await changeRoster(tx, event);

      await expect(transitionEventToBracket(event.eventId, snapshot, undefined, pairings)).rejects.toThrow(
        STALE_PREVIEW_MESSAGE
      );
      expect(await tx.select().from(teams).where(eq(teams.event_id, event.eventId))).toHaveLength(0);
    });
  });

  it('records a hand-edited random draw as manual only when the bracket starts', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedFormat(tx, 4, 2, 'random_pairing');
      const ids = event.eventPlayerIds;
      // Same-pool pairs: invalid for the pool draw, fine once the event is manual.
      const pairings = [
        { members: [{ eventPlayerId: ids[0], slot: 1 }, { eventPlayerId: ids[1], slot: 2 }] },
        { members: [{ eventPlayerId: ids[2], slot: 1 }, { eventPlayerId: ids[3], slot: 2 }] },
      ];
      const assignmentOf = async () =>
        (await tx.select({ a: events.team_assignment }).from(events).where(eq(events.id, event.eventId)))[0].a;

      // A failed start (stale roster) must not leave the event switched to manual.
      const snapshot = await getEventWithPlayers(event.eventId);
      await tx.delete(event_players).where(eq(event_players.id, ids[3]));
      await expect(
        transitionEventToBracket(event.eventId, snapshot, undefined, pairings, { teamAssignment: 'manual' })
      ).rejects.toThrow();
      expect(await assignmentOf()).toBe('random_pairing');
    });

    await withRollback(db, async (tx) => {
      const event = await seedFormat(tx, 4, 2, 'random_pairing');
      const ids = event.eventPlayerIds;
      const pairings = [
        { members: [{ eventPlayerId: ids[0], slot: 1 }, { eventPlayerId: ids[1], slot: 2 }] },
        { members: [{ eventPlayerId: ids[2], slot: 1 }, { eventPlayerId: ids[3], slot: 2 }] },
      ];
      await transitionEventToBracket(
        event.eventId, await getEventWithPlayers(event.eventId), undefined, pairings, { teamAssignment: 'manual' }
      );

      const [row] = await tx.select({ a: events.team_assignment, status: events.status }).from(events)
        .where(eq(events.id, event.eventId));
      expect(row).toEqual({ a: 'manual', status: 'bracket' });
      expect((await storedEntries(tx, event.eventId)).every((entry) => entry.pool === null)).toBe(true);
      expect((await storedTeams(tx, event.eventId)).flat().every((m) => m.role === null)).toBe(true);
    });
  });

  it('draws flat random triples and plays them out', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedFormat(tx, 9, 3, 'random_flat');
      await transitionEventToBracket(event.eventId, await getEventWithPlayers(event.eventId));

      const stored = await storedTeams(tx, event.eventId);
      expect(stored.map((members) => members.map((m) => m.slot))).toEqual([[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
      expect(new Set(stored.flat().map((m) => m.eventPlayerId))).toEqual(new Set(event.eventPlayerIds));
      expect((await storedEntries(tx, event.eventId)).every((entry) => entry.pool === null)).toBe(true);

      await completeEvent(tx, event.eventId);
      const placements = await tx.select().from(event_placements).where(eq(event_placements.event_id, event.eventId));
      expect(placements.map((p) => p.placement).sort()).toEqual([1, 2, 3]);
    });
  });

  it('blocks the transition when players do not split into teams', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedFormat(tx, 7, 3, 'random_flat');
      await expect(transitionEventToBracket(event.eventId, await getEventWithPlayers(event.eventId))).rejects.toThrow(
        "7 players can't be split into teams of 3: add 2 players or remove 1 player before starting bracket play"
      );
    });
  });

  it('still writes pools and matching roles for the random doubles draw', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedFormat(tx, 4, 2, 'random_pairing');
      await transitionEventToBracket(event.eventId, await getEventWithPlayers(event.eventId));

      const poolById = new Map((await storedEntries(tx, event.eventId)).map((entry) => [entry.id, entry.pool]));
      const stored = await storedTeams(tx, event.eventId);
      expect(stored).toHaveLength(2);
      for (const members of stored) {
        expect(members.map((m) => [m.slot, poolById.get(m.eventPlayerId), m.role])).toEqual([
          [1, 'A', 'A_pool'],
          [2, 'B', 'B_pool'],
        ]);
      }
    });
  });
});
