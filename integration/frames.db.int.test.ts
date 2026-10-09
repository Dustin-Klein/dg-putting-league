import { frame_results } from '@/lib/db/schema';
import {
  getFrameCountsForMatches,
  getFrameResultsForMatch,
  getOrCreateFrameWithResults,
} from '@/lib/repositories/frame-repository.db';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, getParticipantPlayers, seedBracket } from './db/seed';

const db = createTestDb();
afterAll(() => closeDb(db));

describe('frame repository (Drizzle)', () => {
  it('returns match results and counts and creates a frame idempotently', async () => {
    await withRollback(db, async (tx) => {
      const event = await seedBracket(tx, { teams: 4 });
      const snapshot = await getBracketSnapshot(tx, event.eventId);
      const match = snapshot.matches.find((candidate) => candidate.opponent1 && candidate.opponent2)!;
      const participantId = Number((match.opponent1 as { id: number }).id);
      const [eventPlayerId] = await getParticipantPlayers(tx, event.eventId, participantId);

      const first = await getOrCreateFrameWithResults(tx, match.id, 1, false);
      const second = await getOrCreateFrameWithResults(tx, match.id, 1, false);
      expect(second.id).toBe(first.id);

      await tx.insert(frame_results).values({
        match_frame_id: first.id,
        event_player_id: eventPlayerId,
        bracket_match_id: match.id,
        putts_made: 2,
        points_earned: 2,
        order_in_frame: 1,
      });

      expect(await getFrameResultsForMatch(tx, match.id)).toEqual([
        expect.objectContaining({ match_frame_id: first.id, event_player_id: eventPlayerId, putts_made: 2 }),
      ]);
      expect(await getFrameCountsForMatches(tx, [match.id])).toEqual({ [match.id]: 1 });
    });
  });
});
