import { event_players, frame_results, match_frames } from '@/lib/db/schema';
import { getPfaScoresBulk } from '@/lib/repositories/event-player-repository.db';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { seedEvent } from './db/seed';

const db = createTestDb();
afterAll(() => closeDb(db));

describe('event-player Drizzle repository', () => {
  it('includes hand-entered frame history with a null bracket_match_id in PFA', async () => {
    await withRollback(db, async (tx) => {
      const first = await seedEvent(tx, { players: 1, status: 'completed' });
      const second = await seedEvent(tx, { players: 0, status: 'created', leagueId: first.leagueId });
      const [secondEntry] = await tx.insert(event_players).values({
        event_id: second.eventId,
        player_id: first.playerIds[0],
      }).returning({ id: event_players.id });

      const [historicalFrame] = await tx.insert(match_frames).values({
        bracket_match_id: null,
        frame_number: 1,
      }).returning({ id: match_frames.id });
      await tx.insert(frame_results).values({
        match_frame_id: historicalFrame.id,
        event_player_id: secondEntry.id,
        bracket_match_id: null,
        putts_made: 3,
        points_earned: 4,
        order_in_frame: 1,
        recorded_at: new Date().toISOString(),
      });

      const scores = await getPfaScoresBulk(tx, first.playerIds, new Date('2025-01-01T00:00:00Z'));
      expect(scores.get(first.playerIds[0])).toEqual({ totalPoints: 4, frameCount: 1 });
    });
  });
});
