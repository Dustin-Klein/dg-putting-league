/**
 * Client lockdown integration tests (plan 01).
 *
 * Talks to a local Supabase stack with the publishable key only, i.e. exactly what
 * anyone can do from a browser. Defaults match `supabase start`; override with
 * SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY.
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

  it('cannot update bracket matches', async () => {
    const { error } = await client.from('bracket_match').update({ status: 4 }).eq('id', 1);
    expectDenied(error);
  });

  it('cannot write frame results', async () => {
    const { error } = await client.from('frame_results').insert({
      match_frame_id: SOME_EVENT_ID,
      event_player_id: SOME_EVENT_ID,
      putts_made: 3,
      points_earned: 4,
    });
    expectDenied(error);
  });

  it('cannot read access codes', async () => {
    const { error } = await client.from('events').select('access_code').limit(1);
    expectDenied(error);
  });

  it('cannot look up an event by access code', async () => {
    const { error } = await client.from('events').select('id').eq('access_code', 'abc123');
    expectDenied(error);
  });

  it('cannot read player emails', async () => {
    const { error } = await client.from('players').select('email').limit(1);
    expectDenied(error);
  });

  it('cannot read payment status', async () => {
    const { error } = await client.from('event_players').select('payment_type').limit(1);
    expectDenied(error);
  });

  it('cannot touch the rate limit store', async () => {
    const { error } = await client.from('rate_limits').select('key').limit(1);
    expectDenied(error);
  });

  it('cannot create a league directly', async () => {
    const { error } = await client.from('leagues').insert({ name: 'Sneaky' });
    expectDenied(error);
  });

  it('can still read public data', async () => {
    const leagues = await client.from('leagues').select('id, name').limit(1);
    expect(leagues.error).toBeNull();

    const events = await client.from('events').select('id, status').limit(1);
    expect(events.error).toBeNull();

    const frames = await client.from('frame_results').select('id').limit(1);
    expect(frames.error).toBeNull();
  });
});
