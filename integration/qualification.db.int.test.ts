import { eq } from 'drizzle-orm';
import { events, qualification_frames, qualification_rounds } from '@/lib/db/schema';
import { recordQualificationScoreDb, type PublicQualificationEventInfo } from '@/lib/services/qualification/qualification-service';
import { closeDb, createTestDb } from './db/harness';
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
