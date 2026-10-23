/**
 * Replay a league's completed events through the handicap rules (plan 06 §9).
 * Read-only: it never writes to the database.
 *
 *   DATABASE_URL=postgresql://... npm run simulate:handicap -- --league <uuid> [options]
 *
 * Options (defaults are the league defaults in lib/types/handicap.ts):
 *   --promote 75 --demote 50 --min-putts 50 --min-matches 3 --window 150|none
 *   --no-qualification       don't count qualification putts
 *   --zones 3 --start-zone 2
 *   --d 5,10,15              distance response: make % lost per zone step (percentage points)
 *   --verbose                print every player's zone timeline
 *
 * This is a historical replay, not a forecast. Every historical putt was taken from
 * one event distance, so the data says nothing about what moving a player 6 ft does
 * to their make %. The replay assumes a player loses `d` points per zone above where
 * they started and reports every outcome for each `d`. Both policies run on the same
 * history: promote-only (the shipping default; demotions become suggestions) and
 * symmetric (automatic demotion), so the cost of either is a number.
 */
import postgres from 'postgres';
import { decideZoneChange } from '@/lib/services/handicap/decision';
import { combinePeriodStats, type EntryCounts } from '@/lib/services/handicap/stats';
import { DEFAULT_HANDICAP_SETTINGS, type HandicapSettings } from '@/lib/types/handicap';

interface Options {
  leagueId: string;
  settings: HandicapSettings;
  zones: number;
  startZone: number;
  responses: number[];
  verbose: boolean;
}

function parseArgs(argv: string[]): Options {
  const args = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags.add(arg.slice(2));
    else args.set(arg.slice(2), argv[++i]);
  }
  const leagueId = args.get('league');
  if (!leagueId) throw new Error('--league <uuid> is required');
  const num = (key: string, fallback: number) => (args.has(key) ? Number(args.get(key)) : fallback);
  const window = args.get('window');
  const startZone = num('start-zone', DEFAULT_HANDICAP_SETTINGS.default_zone);
  return {
    leagueId,
    settings: {
      ...DEFAULT_HANDICAP_SETTINGS,
      enabled: true,
      default_zone: startZone,
      promote_above_pct: num('promote', DEFAULT_HANDICAP_SETTINGS.promote_above_pct),
      demote_below_pct: num('demote', DEFAULT_HANDICAP_SETTINGS.demote_below_pct),
      min_putts: num('min-putts', DEFAULT_HANDICAP_SETTINGS.min_putts),
      min_matches: num('min-matches', DEFAULT_HANDICAP_SETTINGS.min_matches),
      window_putts: window === undefined ? DEFAULT_HANDICAP_SETTINGS.window_putts : window === 'none' ? null : Number(window),
      count_qualification_putts: !flags.has('no-qualification'),
    },
    zones: num('zones', 3),
    startZone,
    responses: (args.get('d') ?? '5,10,15').split(',').map(Number),
    verbose: flags.has('verbose'),
  };
}

interface HistoryRow extends EntryCounts {
  player_id: string;
  player_name: string;
}

/** Per-entry counts for every completed event in the league, oldest first. */
async function loadHistory(sql: postgres.Sql, leagueId: string): Promise<HistoryRow[]> {
  const rows = await sql<Array<Record<string, string>>>`
    select ep.player_id, p.full_name as player_name,
           e.id as event_id, e.event_date::text as event_date, e.created_at::text as event_created_at,
           coalesce(f.frames, 0) as frames, coalesce(f.putts_made, 0) as frame_putts_made,
           coalesce(q.frames, 0) as qualification_frames, coalesce(q.putts_made, 0) as qualification_putts_made,
           coalesce(m.matches, 0) as matches
    from putting_league.event_players ep
    join putting_league.events e on e.id = ep.event_id
    join public.players p on p.id = ep.player_id
    left join lateral (
      select count(*) as frames, sum(fr.putts_made) as putts_made
      from putting_league.frame_results fr where fr.event_player_id = ep.id
    ) f on true
    left join lateral (
      select count(*) as frames, sum(qf.putts_made) as putts_made
      from putting_league.qualification_frames qf where qf.event_player_id = ep.id
    ) q on true
    left join lateral (
      select count(distinct fr.bracket_match_id) as matches
      from putting_league.frame_results fr
      join putting_league.bracket_match bm on bm.id = fr.bracket_match_id
      where fr.event_player_id = ep.id and bm.status in (4, 5)
    ) m on true
    where e.league_id = ${leagueId} and e.status = 'completed'
    order by e.event_date, e.created_at, p.full_name`;
  return rows.map((row) => ({
    player_id: row.player_id,
    player_name: row.player_name,
    event_id: row.event_id,
    event_date: row.event_date,
    event_created_at: new Date(row.event_created_at).toISOString(),
    frames: Number(row.frames),
    frame_putts_made: Number(row.frame_putts_made),
    qualification_frames: Number(row.qualification_frames),
    qualification_putts_made: Number(row.qualification_putts_made),
    matches: Number(row.matches),
  }));
}

/** Shift an entry's makes by `d` points per zone above the start (the assumed distance response). */
function atZone(entry: EntryCounts, zone: number, startZone: number, d: number): EntryCounts {
  const shift = (made: number, frames: number) => {
    const attempted = frames * 3;
    const adjusted = Math.round(made - (d / 100) * attempted * (zone - startZone));
    return Math.min(attempted, Math.max(0, adjusted));
  };
  return {
    ...entry,
    frame_putts_made: shift(entry.frame_putts_made, entry.frames),
    qualification_putts_made: shift(entry.qualification_putts_made, entry.qualification_frames),
  };
}

type Policy = 'promote-only' | 'symmetric';

interface PlayerState {
  name: string;
  zone: number;
  period: EntryCounts[];
  timeline: string[];
  /** Directions of applied moves, most recent last, with the evaluation index. */
  moves: Array<{ direction: 1 | -1; at: number }>;
  evaluations: number;
  lowStreak: number;
  overshot: boolean;
  pingPong: boolean;
}

interface Outcome {
  policy: Policy;
  d: number;
  eventMoves: Array<{ event_id: string; date: string; up: number; down: number; suggestions: number; evaluated: number }>;
  makePcts: number[];
  players: Map<string, PlayerState>;
}

function replay(history: HistoryRow[], options: Options, policy: Policy, d: number): Outcome {
  const players = new Map<string, PlayerState>();
  const byEvent = new Map<string, HistoryRow[]>();
  for (const row of history) {
    const list = byEvent.get(row.event_id) ?? [];
    list.push(row);
    byEvent.set(row.event_id, list);
  }

  const outcome: Outcome = { policy, d, eventMoves: [], makePcts: [], players };
  for (const [eventId, rows] of byEvent) {
    const tally = { event_id: eventId, date: rows[0].event_date, up: 0, down: 0, suggestions: 0, evaluated: 0 };
    for (const row of rows) {
      let state = players.get(row.player_id);
      if (!state) {
        state = {
          name: row.player_name, zone: options.startZone, period: [], timeline: [`${row.event_date}: start Z${options.startZone}`],
          moves: [], evaluations: 0, lowStreak: 0, overshot: false, pingPong: false,
        };
        players.set(row.player_id, state);
      }
      state.period.push(atZone(row, state.zone, options.startZone, d));
      const stats = combinePeriodStats(state.period, options.settings);
      const decision = decideZoneChange(stats, options.settings, state.zone, options.zones);
      if (!decision.eligible) continue;

      tally.evaluated++;
      state.evaluations++;
      if (stats.make_pct !== null) outcome.makePcts.push(stats.make_pct);
      const low = stats.make_pct !== null && stats.make_pct < options.settings.demote_below_pct;
      state.lowStreak = low ? state.lowStreak + 1 : 0;
      if (policy === 'promote-only' && state.lowStreak >= 2) state.overshot = true;

      const move = decision.action === 'promote' ? 1 : decision.action === 'demote' && policy === 'symmetric' ? -1 : 0;
      if (decision.action === 'demote' && policy === 'promote-only') tally.suggestions++;
      if (move === 0) continue;

      const previous = state.moves[state.moves.length - 1];
      if (previous && previous.direction !== move && state.evaluations - previous.at <= 3) state.pingPong = true;
      state.moves.push({ direction: move, at: state.evaluations });
      state.zone += move;
      state.period = [];
      state.lowStreak = 0;
      if (move > 0) tally.up++;
      else tally.down++;
      state.timeline.push(`${row.event_date}: ${move > 0 ? 'up' : 'down'} to Z${state.zone} at ${stats.make_pct}% over ${stats.putts_attempted}`);
    }
    outcome.eventMoves.push(tally);
  }
  return outcome;
}

function histogram(values: number[]): string {
  const buckets = new Array(10).fill(0);
  for (const value of values) buckets[Math.min(9, Math.floor(value / 10))]++;
  return buckets.map((count, i) => `${i * 10}-${i * 10 + 9}%: ${count}`).join('  ');
}

function report(outcome: Outcome, verbose: boolean): void {
  const players = [...outcome.players.values()];
  const zones = new Map<number, number>();
  for (const player of players) zones.set(player.zone, (zones.get(player.zone) ?? 0) + 1);
  const totalSuggestions = outcome.eventMoves.reduce((sum, e) => sum + e.suggestions, 0);

  console.log(`\n=== ${outcome.policy}, d = ${outcome.d} pp per zone step ===`);
  console.log(`players: ${players.length}; final zones: ${[...zones.entries()].sort().map(([z, n]) => `Z${z}=${n}`).join(', ')}`);
  console.log('per event (date: evaluated / up / down / suggestions):');
  for (const event of outcome.eventMoves) {
    console.log(`  ${event.date}: ${event.evaluated} / ${event.up} / ${event.down} / ${event.suggestions}`);
  }
  console.log(`make % per eligible evaluation: ${histogram(outcome.makePcts)}`);
  if (outcome.policy === 'symmetric') {
    console.log(`ping-pong players (opposite moves within 3 evaluations): ${players.filter((p) => p.pingPong).length}`);
  } else {
    console.log(`overshoot (below demote threshold for 2+ consecutive eligible evaluations): ${players.filter((p) => p.overshot).length}`);
    console.log(`demotion suggestions to triage: ${totalSuggestions} (${(totalSuggestions / Math.max(1, outcome.eventMoves.length)).toFixed(1)} per event)`);
  }
  if (verbose) {
    for (const player of players) console.log(`  ${player.name}: ${player.timeline.join(' → ')}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set');
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const history = await sql.begin('read only', (tx) => loadHistory(tx as unknown as postgres.Sql, options.leagueId));
    console.log(`League ${options.leagueId}: ${new Set(history.map((r) => r.event_id)).size} completed events, ${history.length} entries`);
    console.log(`Settings: ${JSON.stringify(options.settings)}`);
    for (const d of options.responses) {
      for (const policy of ['promote-only', 'symmetric'] as const) {
        report(replay(history, options, policy, d), options.verbose);
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
