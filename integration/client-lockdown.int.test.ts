/**
 * Client lockdown integration tests (plan 01).
 *
 * Talks to a local Supabase stack with the publishable key only, i.e. exactly what
 * anyone can do from a browser. Defaults match `supabase start`; override with
 * SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY.
 *
 * The putting league's tables live in the `putting_league` schema, which PostgREST
 * doesn't expose: the API can't reach them at all. Only the shared `players` table
 * is in `public`. (Grants and RLS on putting_league, which Realtime relies on, are
 * covered by supabase/tests/security_lockdown.test.sql.)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const publishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

const SOME_EVENT_ID = '00000000-0000-0000-0000-000000000001';

function newClient(): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function expectDenied(error: { code?: string; message: string } | null) {
  expect(error).not.toBeNull();
  // 42501 = insufficient_privilege
  expect(error?.code).toBe('42501');
}

function expectUnreachable(error: { code?: string; message: string } | null) {
  expect(error).not.toBeNull();
  // PGRST205 = table not in the schema cache; PGRST106 = schema not exposed
  expect(['PGRST205', 'PGRST106']).toContain(error?.code);
}

const LEAGUE_TABLES = ['leagues', 'events', 'event_players', 'bracket_match', 'frame_results', 'rate_limits'];

describe.each([
  ['anon', async () => newClient()],
  [
    'authenticated (fresh sign-up)',
    async () => {
      const client = newClient();
      const email = `lockdown-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
      const { error } = await client.auth.signUp({ email, password: 'lockdown-test-password-1' });
      if (error) throw error;
      return client;
    },
  ],
])('as %s', (_label, makeClient) => {
  let client: SupabaseClient;

  beforeAll(async () => {
    client = await makeClient();
  });

  it.each([
    ['rollback_bracket_transition', { p_event_id: SOME_EVENT_ID }],
    ['update_bracket_match_score', { p_match_id: 1, p_status: 4, p_opponent1: null, p_opponent2: null }],
    ['transition_event_to_bracket', { p_event_id: SOME_EVENT_ID, p_pool_assignments: [], p_teams: [], p_lane_count: 0 }],
    ['get_user_id_by_email', { league_id_param: SOME_EVENT_ID, email_param: 'a@example.test' }],
  ])('cannot call the retired %s RPC', async (fn, args) => {
    const { error } = await client.rpc(fn, args);
    expect(error).not.toBeNull();
    // PGRST202 = function not found (retired in plan 04); 42501 = not executable
    expect(['PGRST202', '42501']).toContain(error?.code);
  });

  it.each(LEAGUE_TABLES)('cannot reach putting_league.%s through the API', async (table) => {
    expectUnreachable((await client.from(table).select('*').limit(1)).error);
    expectUnreachable((await client.schema('putting_league').from(table).select('*').limit(1)).error);
  });

  it('cannot write league tables through the API', async () => {
    expectUnreachable((await client.from('bracket_match').update({ status: 4 }).eq('id', 1)).error);
    expectUnreachable((await client.from('leagues').insert({ name: 'Sneaky' })).error);
    expectUnreachable(
      (await client.schema('putting_league').from('leagues').insert({ name: 'Sneaky' })).error
    );
  });

  it('cannot read player emails', async () => {
    const { error } = await client.from('players').select('email').limit(1);
    expectDenied(error);
  });

  it('cannot write players', async () => {
    const { error } = await client.from('players').insert({ full_name: 'Sneaky' });
    expectDenied(error);
  });

  it('can still read public player identity', async () => {
    const players = await client.from('players').select('id, player_number, full_name, nickname').limit(1);
    expect(players.error).toBeNull();
  });
});
