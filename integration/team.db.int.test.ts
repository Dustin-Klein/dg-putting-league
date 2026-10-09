import type { Executor } from '@/lib/db/tx';
import { getPublicTeamsByParticipantIds, getTeamsByParticipantIds } from '@/lib/repositories/team-repository.db';
import { closeDb, createTestDb, withRollback } from './db/harness';
import { getBracketSnapshot, seedBracket } from './db/seed';

const db = createTestDb();
afterAll(() => closeDb(db));

describe('team repository (Drizzle)', () => {
  it('returns all teams keyed by participant id from the batched lookup', async () => {
    await withRollback(db, async (tx: Executor) => {
      const event = await seedBracket(tx, { teams: 4 });
      const snapshot = await getBracketSnapshot(tx, event.eventId);
      const participantIds = snapshot.participants.slice(0, 3).map((participant) => participant.id);

      const teams = await getTeamsByParticipantIds(tx, event.eventId, participantIds);
      expect([...teams.keys()]).toEqual(participantIds);
      for (const team of teams.values()) expect(team.players).toHaveLength(2);

      const publicTeams = await getPublicTeamsByParticipantIds(tx, event.eventId, participantIds);
      expect([...publicTeams.keys()]).toEqual(participantIds);
      for (const team of publicTeams.values()) {
        expect(team.players[0]).not.toHaveProperty('player');
        expect(team.players[0]).not.toHaveProperty('payment_type');
        expect(team.players[0]).not.toHaveProperty('email');
      }
    });
  });

  it('does not return a participant from another event', async () => {
    await withRollback(db, async (tx: Executor) => {
      const event = await seedBracket(tx, { teams: 2 });
      const other = await seedBracket(tx, { teams: 2 });
      const otherParticipant = (await getBracketSnapshot(tx, other.eventId)).participants[0].id;
      expect(await getTeamsByParticipantIds(tx, event.eventId, [otherParticipant])).toEqual(new Map());
    });
  });
});
