/**
 * Fixed data for the visual tests. Run once against a fresh local stack
 * (`supabase start` or `supabase db reset`) before `npm run test:visual`:
 *
 *   npm run test:visual:seed
 *
 * Every name, date and score is fixed, and a fresh database hands out the same
 * player numbers and match ids, so screenshots only change when the UI does.
 * Writes the ids the tests need to e2e/visual/.seed.json.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { event_players, events, leagues, players } from '@/lib/db/schema';
import { closeDb, createTestDb } from '../../integration/db/harness';
import { buildDeterministicPairings, getBracketSnapshot, type SeededEvent } from '../../integration/db/seed';
import { playMatch, playableMatches, scoreMatch } from '../../integration/db/play';
import { startBracket } from '@/lib/services/event/event-service';

const PLAYER_NAMES = [
  'Avery Lund',
  'Blake Ortiz',
  'Casey Nguyen',
  'Devon Price',
  'Emery Walsh',
  'Finley Shah',
  'Gray Moreno',
  'Harper Quinn',
];

export const ACCESS_CODE = 'visual-test';

async function main() {
  const db = createTestDb(2);
  try {
    const [league] = await db
      .insert(leagues)
      .values({ name: 'Thursday Night Putting', city: 'Testville' })
      .returning({ id: leagues.id });

    const [event] = await db
      .insert(events)
      .values({
        league_id: league.id,
        event_date: '2026-10-08',
        location: 'Riverside Park',
        lane_count: 2,
        putt_distance_ft: '25',
        access_code: ACCESS_CODE,
        bonus_point_enabled: true,
        bracket_frame_count: 5,
        double_grand_final: true,
        status: 'pre-bracket',
        // drizzle-kit renders these numeric NULL defaults as the string 'NULL'; pass them explicitly.
        entry_fee_per_player: null,
        admin_fees: null,
        admin_fee_per_player: null,
        payout_pool_override: null,
      })
      .returning({ id: events.id });

    const insertedPlayers = await db
      .insert(players)
      .values(PLAYER_NAMES.map((full_name) => ({ full_name })))
      .returning({ id: players.id, player_number: players.player_number });
    const playerIds = insertedPlayers.map((p) => p.id);
    const entries = await db
      .insert(event_players)
      .values(playerIds.map((player_id) => ({ event_id: event.id, player_id, payment_type: 'cash' as const, putt_distance_ft: '25' })))
      .returning({ id: event_players.id, player_id: event_players.player_id });
    const entryByPlayer = new Map(entries.map((e) => [e.player_id, e.id]));

    const seeded: SeededEvent = {
      leagueId: league.id,
      eventId: event.id,
      accessCode: ACCESS_CODE,
      eventPlayerIds: playerIds.map((id) => entryByPlayer.get(id)!),
      playerIds,
      playerNames: PLAYER_NAMES,
    };
    const { poolAssignments, teamPairings } = buildDeterministicPairings(seeded);
    await startBracket(db, event.id, poolAssignments, teamPairings);

    // Mid-event: two first-round matches finished, one partly scored.
    const first = playableMatches(await getBracketSnapshot(db, event.id)).sort((a, b) => a.id - b.id);
    await playMatch(db, event.id, first[0].id, 'opponent1');
    await playMatch(db, event.id, first[1].id, 'opponent2');
    const next = playableMatches(await getBracketSnapshot(db, event.id)).sort((a, b) => a.id - b.id);
    await scoreMatch(db, event.id, next[0].id, 'opponent1', 2);

    const out = { leagueId: league.id, eventId: event.id, accessCode: ACCESS_CODE, playerNumber: insertedPlayers[0].player_number };
    writeFileSync(path.join(__dirname, '.seed.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out));
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
