import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { event_players, events, team_members, teams } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/tx';
import * as eventDb from '@/lib/repositories/event-repository.db';
import * as placementDb from '@/lib/repositories/event-placement-repository.db';
import { createEvent as createEventService, getEventForViewer } from '@/lib/services/event/event-service';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { seedEvent } from './db/seed';

const mockAuth: { tx?: Executor; isAdmin: boolean } = { isAdmin: false };
const mockRepo = { failCopy: false };
jest.mock('@/lib/services/auth', () => ({
  authorizeLeagueAdmin: async () => ({
    user: { id: 'integration-user' },
    pg: mockAuth.tx,
  }),
  authorizeEventAdmin: async () => ({
    user: { id: 'integration-user' },
    event: {},
    pg: mockAuth.tx,
  }),
  authorizeEventView: async (eventId: string) => ({
    user: mockAuth.isAdmin ? { id: 'integration-user' } : null,
    event: { id: eventId },
    isAdmin: mockAuth.isAdmin,
    pg: mockAuth.tx,
  }),
}));
jest.mock('@/lib/repositories/event-repository.db', () => {
  const actual = jest.requireActual<typeof import('@/lib/repositories/event-repository.db')>(
    '@/lib/repositories/event-repository.db'
  );
  return {
    ...actual,
    copyEventPlayers: (...args: Parameters<typeof actual.copyEventPlayers>) =>
      mockRepo.failCopy
        ? Promise.reject(new Error('copy failed'))
        : actual.copyEventPlayers(...args),
  };
});

const db = createTestDb();
afterAll(() => closeDb(db));

function accessCode(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

describe('event Drizzle repository and service', () => {
  it('assembles nested players and teams with mapped values and no email', async () => {
    await withRollback(db, async (tx) => {
      const seeded = await seedEvent(tx, { players: 2, status: 'bracket' });
      await tx.update(events).set({
        putt_distance_ft: '27.50',
        entry_fee_per_player: '12.50',
        admin_fees: '5.25',
        admin_fee_per_player: '1.50',
        payout_pool_override: '20.00',
      }).where(eq(events.id, seeded.eventId));
      await tx.update(event_players).set({ pfa_score: '8.75' })
        .where(eq(event_players.id, seeded.eventPlayerIds[0]));
      const [team] = await tx.insert(teams).values({
        event_id: seeded.eventId,
        seed: 1,
        pool_combo: 'A/B',
      }).returning({ id: teams.id });
      await tx.insert(team_members).values([
        { team_id: team.id, event_player_id: seeded.eventPlayerIds[0], role: 'A_pool' },
        { team_id: team.id, event_player_id: seeded.eventPlayerIds[1], role: 'B_pool' },
      ]);

      const event = await eventDb.getEventWithPlayers(tx, seeded.eventId, { includePaymentType: true });
      expect(event).toMatchObject({
        putt_distance_ft: 27.5,
        entry_fee_per_player: 12.5,
        admin_fees: 5.25,
        admin_fee_per_player: 1.5,
        payout_pool_override: 20,
      });
      expect(event.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(event.players[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(event.players.find((player) => player.id === seeded.eventPlayerIds[0])?.pfa_score).toBe(8.75);
      expect(event.players.every((player) => !('email' in player.player))).toBe(true);
      expect(event.teams).toHaveLength(1);
      expect(event.teams[0].team_members.map((member) => member.event_player))
        .toEqual(expect.arrayContaining(event.players));
      expect(event.teams[0].team_members[0].joined_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  it('creates an event and copies players in one service transaction', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.tx = tx;
      const source = await seedEvent(tx, { players: 3, status: 'completed' });
      const created = await createEventService({
        league_id: source.leagueId,
        event_date: '2026-10-09',
        location: 'Copied event',
        lane_count: 2,
        putt_distance_ft: 25,
        access_code: accessCode('copy'),
        qualification_round_enabled: false,
        bracket_frame_count: 5,
        qualification_frame_count: 5,
        copy_players_from_event_id: source.eventId,
      });
      const copied = await tx.select({ player_id: event_players.player_id }).from(event_players)
        .where(eq(event_players.event_id, created.id));
      expect(new Set(copied.map((row) => row.player_id))).toEqual(new Set(source.playerIds));
    });
  });

  it('rolls back the event insert when player copying fails', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.tx = tx;
      const source = await seedEvent(tx, { players: 1, status: 'completed' });
      const code = accessCode('fail');
      mockRepo.failCopy = true;
      try {
        await expect(createEventService({
          league_id: source.leagueId,
          event_date: '2026-10-09',
          location: null,
          lane_count: 1,
          putt_distance_ft: 25,
          access_code: code,
          qualification_round_enabled: false,
          bracket_frame_count: 5,
          qualification_frame_count: 5,
          copy_players_from_event_id: source.eventId,
        })).rejects.toThrow('copy failed');
      } finally {
        mockRepo.failCopy = false;
      }
      const inserted = await tx.select({ id: events.id }).from(events).where(eq(events.access_code, code));
      expect(inserted).toHaveLength(0);
    });
  });

  it('returns participant counts for every event in one league', async () => {
    await withRollback(db, async (tx) => {
      const first = await seedEvent(tx, { players: 2, status: 'completed' });
      const second = await seedEvent(tx, { players: 3, status: 'created', leagueId: first.leagueId });
      const result = await eventDb.getEventsByLeagueId(tx, first.leagueId);
      expect(new Map(result.map((event) => [event.id, event.participant_count]))).toEqual(
        new Map([[first.eventId, 2], [second.eventId, 3]])
      );
    });
  });

  it('reads stored placements and their distinct event ids', async () => {
    await withRollback(db, async (tx) => {
      const seeded = await seedEvent(tx, { players: 0, status: 'completed' });
      const [team] = await tx.insert(teams).values({ event_id: seeded.eventId, seed: 1 })
        .returning({ id: teams.id });
      await placementDb.upsertEventPlacements(tx, [{
        eventId: seeded.eventId,
        teamId: team.id,
        placement: 1,
      }]);

      await expect(placementDb.getStoredPlacementsForEvents(tx, [seeded.eventId])).resolves.toEqual([{
        eventId: seeded.eventId,
        teamId: team.id,
        placement: 1,
      }]);
      await expect(placementDb.getEventsWithStoredPlacements(tx, [seeded.eventId]))
        .resolves.toEqual(new Set([seeded.eventId]));
    });
  });

  it('hides access code and payment type from non-admin viewers', async () => {
    await withRollback(db, async (tx) => {
      mockAuth.tx = tx;
      mockAuth.isAdmin = false;
      const seeded = await seedEvent(tx, { players: 1, status: 'completed' });
      const event = await getEventForViewer(seeded.eventId);
      expect(event.access_code).toBeNull();
      expect(event.players.every((player) => !('payment_type' in player))).toBe(true);

      mockAuth.isAdmin = true;
      const adminEvent = await getEventForViewer(seeded.eventId);
      expect(adminEvent.access_code).toBe(seeded.accessCode);
      expect(adminEvent.players[0].payment_type).toBe('cash');
      mockAuth.isAdmin = false;
    });
  });
});
