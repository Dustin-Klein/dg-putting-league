jest.mock('@/lib/services/auth', () => ({
  authorizePublicRead: jest.fn(),
  getViewer: jest.fn(),
}));

import { and, eq, inArray } from 'drizzle-orm';
import {
  bracket_match,
  bracket_participant,
  event_players,
  frame_results,
  match_frames,
  players,
  team_members,
} from '@/lib/db/schema';
import { authorizePublicRead, getViewer } from '@/lib/services/auth';
import { updateEventSettingsTx } from '@/lib/services/event/event-service';
import { getPlayerProfile } from '@/lib/services/player-statistics/player-statistics-service';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { playOutBracket } from './db/play';
import { seedBracket, seedEvent, type Opponent } from './db/seed';

const db = createTestDb();
afterAll(() => closeDb(db));

describe('player statistics profile', () => {
  it('loads completed results, historical frames, and hides created events', async () => {
    await withRollback(db, async (tx) => {
      (authorizePublicRead as jest.Mock).mockReturnValue({ pg: tx });
      (getViewer as jest.Mock).mockResolvedValue(null);

      const event = await seedBracket(tx, { teams: 4, doubleGrandFinal: false });
      const targetEventPlayerId = event.eventPlayerIds[0];
      const [target] = await tx
        .select({
          teamId: team_members.team_id,
          participantId: bracket_participant.id,
          playerNumber: players.player_number,
        })
        .from(team_members)
        .innerJoin(
          bracket_participant,
          eq(bracket_participant.team_id, team_members.team_id)
        )
        .innerJoin(event_players, eq(event_players.id, team_members.event_player_id))
        .innerJoin(players, eq(players.id, event_players.player_id))
        .where(eq(team_members.event_player_id, targetEventPlayerId));
      if (!target) throw new Error('Target participant was not seeded');

      await playOutBracket(tx, event.eventId, (match) => {
        const opponent1 = match.opponent1 as Opponent;
        return opponent1?.id === target.participantId ? 'opponent1' : 'opponent2';
      });
      await updateEventSettingsTx(tx, event.eventId, { status: 'completed' });

      const [historicalFrame] = await tx
        .insert(match_frames)
        .values({ bracket_match_id: null, frame_number: 99 })
        .returning({ id: match_frames.id });
      await tx.insert(frame_results).values({
        match_frame_id: historicalFrame.id,
        event_player_id: targetEventPlayerId,
        bracket_match_id: null,
        putts_made: 2,
        points_earned: 2,
        order_in_frame: 1,
      });

      const privateEvent = await seedEvent(tx, {
        players: 0,
        status: 'created',
        leagueId: event.leagueId,
      });
      await tx.insert(event_players).values({
        event_id: privateEvent.eventId,
        player_id: event.playerIds[0],
        payment_type: 'cash',
      });
      await tx
        .update(players)
        .set({ email: 'private@example.com' })
        .where(eq(players.id, event.playerIds[0]));

      const completedMatches = await tx
        .select({ opponent1: bracket_match.opponent1, opponent2: bracket_match.opponent2 })
        .from(bracket_match)
        .where(and(eq(bracket_match.event_id, event.eventId), inArray(bracket_match.status, [4, 5])));
      const expectedRecord = completedMatches.reduce(
        (record, row) => {
          const opponent = [row.opponent1, row.opponent2]
            .map((value) => value as Opponent)
            .find((value) => value?.id === target.participantId);
          if (opponent?.result === 'win') record.wins++;
          if (opponent?.result === 'loss') record.losses++;
          return record;
        },
        { wins: 0, losses: 0 }
      );
      const targetFrames = await tx
        .select({ points: frame_results.points_earned, matchId: frame_results.bracket_match_id })
        .from(frame_results)
        .where(eq(frame_results.event_player_id, targetEventPlayerId));
      const expectedAverage =
        targetFrames.reduce((sum, frame) => sum + frame.points, 0) / targetFrames.length;

      const profile = await getPlayerProfile(target.playerNumber);

      expect(profile.player.email).toBeUndefined();
      expect(profile.statistics.eventsPlayed).toBe(1);
      expect(profile.statistics.totalWins).toBe(expectedRecord.wins);
      expect(profile.statistics.totalLosses).toBe(expectedRecord.losses);
      expect(profile.statistics.perFrameAverage).toBeCloseTo(expectedAverage);
      expect(targetFrames.some((frame) => frame.matchId === null)).toBe(true);
      expect(profile.eventHistory).toHaveLength(1);
      expect(profile.eventHistory[0]).toMatchObject({
        eventId: event.eventId,
        placement: 1,
        wins: expectedRecord.wins,
        losses: expectedRecord.losses,
      });
      expect(profile.ongoingEvents).toEqual([]);
      expect(profile.eventHistory.some((history) => history.eventId === privateEvent.eventId)).toBe(false);
    });
  });
});
