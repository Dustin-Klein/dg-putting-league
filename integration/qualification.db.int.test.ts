import { eq, inArray } from 'drizzle-orm';
import { event_players, events, qualification_frames, qualification_rounds } from '@/lib/db/schema';
import {
  recordQualificationScoreDb,
  recordQualificationScoresDb,
  type PublicQualificationEventInfo,
} from '@/lib/services/qualification/qualification-service';
import { closeDb, createCountingTestDb, createTestDb, withRollback } from './db/harness';
import { cleanupLeague, seedEvent, type SeededEvent } from './db/seed';

const db = createTestDb(10);
const seeded: SeededEvent[] = [];

afterAll(async () => {
  for (const event of seeded) await cleanupLeague(db, event);
  await closeDb(db);
});

describe('qualification transactional scoring', () => {
  it('allows exactly one concurrent scorer to claim the last available frame slot', async () => {
    const seededEvent = await seedEvent(db, { players: 1, status: 'pre-bracket' });
    seeded.push(seededEvent);
    await db.update(events).set({
      qualification_round_enabled: true,
      qualification_frame_count: 3,
    }).where(eq(events.id, seededEvent.eventId));

    const [round] = await db.insert(qualification_rounds).values({
      event_id: seededEvent.eventId,
      frame_count: 3,
      status: 'in_progress',
    }).returning({ id: qualification_rounds.id });
    await db.insert(qualification_frames).values([
      {
        qualification_round_id: round.id,
        event_id: seededEvent.eventId,
        event_player_id: seededEvent.eventPlayerIds[0],
        frame_number: 1,
        putts_made: 1,
        points_earned: 1,
      },
      // Legacy out-of-range data leaves two valid frame numbers competing for one count slot.
      {
        qualification_round_id: round.id,
        event_id: seededEvent.eventId,
        event_player_id: seededEvent.eventPlayerIds[0],
        frame_number: 99,
        putts_made: 1,
        points_earned: 1,
      },
    ]);

    const event: PublicQualificationEventInfo = {
      id: seededEvent.eventId,
      event_date: '2026-10-08',
      location: 'Integration test',
      lane_count: 1,
      bonus_point_enabled: true,
      qualification_round_enabled: true,
      qualification_frame_count: 3,
      status: 'pre-bracket',
    };
    const results = await Promise.allSettled([
      recordQualificationScoreDb(db, event, seededEvent.eventPlayerIds[0], 2, 2),
      recordQualificationScoreDb(db, event, seededEvent.eventPlayerIds[0], 3, 2),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rows = await db.select().from(qualification_frames)
      .where(eq(qualification_frames.event_player_id, seededEvent.eventPlayerIds[0]));
    expect(rows).toHaveLength(3);
  });

});

describe('group qualification saves', () => {
  const counting = createCountingTestDb();
  afterAll(() => closeDb(counting.db));

  const eventInfo = (eventId: string, frameCount = 3): PublicQualificationEventInfo => ({
    id: eventId,
    event_date: '2026-10-08',
    location: 'Integration test',
    lane_count: 1,
    bonus_point_enabled: true,
    qualification_round_enabled: true,
    qualification_frame_count: frameCount,
    status: 'pre-bracket',
  });

  async function framesOf(ex: Parameters<Parameters<typeof withRollback>[1]>[0], ids: string[]) {
    return ex.select().from(qualification_frames).where(inArray(qualification_frames.event_player_id, ids));
  }

  it('saves every player in a bounded number of statements, regardless of group size', async () => {
    const totals: number[] = [];
    for (const players of [2, 8]) {
      await withRollback(counting.db, async (tx) => {
        const seededEvent = await seedEvent(tx, { players });
        const scores = seededEvent.eventPlayerIds.map((eventPlayerId, i) => ({ eventPlayerId, puttsMade: i % 4 }));

        const { total } = await counting.count(() =>
          recordQualificationScoresDb(tx, eventInfo(seededEvent.eventId), 1, scores)
        );
        totals.push(total);

        const rows = await framesOf(tx, seededEvent.eventPlayerIds);
        expect(rows).toHaveLength(players);
        expect(rows.map((r) => r.points_earned).sort()).toEqual(
          scores.map((s) => (s.puttsMade === 3 ? 4 : s.puttsMade)).sort()
        );
        const [round] = await tx.select().from(qualification_rounds).where(eq(qualification_rounds.event_id, seededEvent.eventId));
        expect(round.status).toBe('in_progress');
      });
    }
    expect(totals[1]).toBe(totals[0]);
  });

  it('returns each player\'s totals and overwrites the same frame on retry', async () => {
    await withRollback(counting.db, async (tx) => {
      const seededEvent = await seedEvent(tx, { players: 2 });
      const [a, b] = seededEvent.eventPlayerIds;
      const event = eventInfo(seededEvent.eventId);

      await recordQualificationScoresDb(tx, event, 1, [{ eventPlayerId: a, puttsMade: 3 }, { eventPlayerId: b, puttsMade: 1 }]);
      const { results } = await recordQualificationScoresDb(tx, event, 1, [
        { eventPlayerId: a, puttsMade: 2 },
        { eventPlayerId: b, puttsMade: 1 },
      ]);

      expect(results.map((r) => [r.player.event_player_id, r.frame.points_earned, r.player.total_points, r.player.frames_completed])).toEqual([
        [a, 2, 2, 1],
        [b, 1, 1, 1],
      ]);
      expect(await framesOf(tx, [a, b])).toHaveLength(2);
    });
  });

  it.each([
    ['an unpaid player', 'Player must be marked as paid'],
    ['a player from another event', 'Event player not found'],
    ['a player who finished every frame', 'has already completed all 1 qualification frames'],
  ])('rolls back the whole group for %s', async (scenario, message) => {
    await withRollback(counting.db, async (tx) => {
      const seededEvent = await seedEvent(tx, { players: 3 });
      const [a, b, c] = seededEvent.eventPlayerIds;
      const event = eventInfo(seededEvent.eventId, 1);
      let last = c;
      if (scenario === 'an unpaid player') {
        await tx.update(event_players).set({ payment_type: null }).where(eq(event_players.id, c));
      } else if (scenario === 'a player from another event') {
        last = (await seedEvent(tx, { players: 1 })).eventPlayerIds[0];
      } else {
        await recordQualificationScoresDb(tx, event, 1, [{ eventPlayerId: c, puttsMade: 1 }]);
        // A different (out-of-range) frame number, so the limit applies rather than an overwrite.
        await tx.update(qualification_frames).set({ frame_number: 7 }).where(eq(qualification_frames.event_player_id, c));
      }

      await expect(
        recordQualificationScoresDb(tx, event, 1, [
          { eventPlayerId: a, puttsMade: 2 },
          { eventPlayerId: b, puttsMade: 2 },
          { eventPlayerId: last, puttsMade: 2 },
        ])
      ).rejects.toThrow(message);
      expect(await framesOf(tx, [a, b])).toHaveLength(0);
    });
  });

  it('rejects duplicate players and out-of-range frames', async () => {
    await withRollback(counting.db, async (tx) => {
      const seededEvent = await seedEvent(tx, { players: 1 });
      const [a] = seededEvent.eventPlayerIds;
      const event = eventInfo(seededEvent.eventId);
      await expect(
        recordQualificationScoresDb(tx, event, 1, [{ eventPlayerId: a, puttsMade: 1 }, { eventPlayerId: a, puttsMade: 2 }])
      ).rejects.toThrow('only once');
      await expect(recordQualificationScoresDb(tx, event, 4, [{ eventPlayerId: a, puttsMade: 1 }])).rejects.toThrow(
        'Frame number must be between 1 and 3'
      );
    });
  });

  it('serializes with single-player saves on the last free frame slot', async () => {
    const seededEvent = await seedEvent(db, { players: 2 });
    seeded.push(seededEvent);
    const [a, b] = seededEvent.eventPlayerIds;
    const event = eventInfo(seededEvent.eventId, 1);

    const results = await Promise.allSettled([
      recordQualificationScoresDb(db, event, 1, [{ eventPlayerId: a, puttsMade: 1 }, { eventPlayerId: b, puttsMade: 1 }]),
      recordQualificationScoreDb(db, event, a, 1, 3),
    ]);

    // Both succeed (same frame: the later write wins), and a stays at one frame.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = await db.select().from(qualification_frames).where(eq(qualification_frames.event_player_id, a));
    expect(rows).toHaveLength(1);
  });
});
