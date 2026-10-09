-- Security lockdown tests (plan 01). Run with: supabase test db
--
-- Clients (anon, authenticated) may only read, through RLS. They can't write any
-- table, read access codes or emails, or execute business functions.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT no_plan();

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Every function a client can execute must be on this allowlist.
CREATE TEMP TABLE client_callable (proname text, role text);
INSERT INTO client_callable VALUES
  ('is_league_admin', 'anon'), ('is_league_admin', 'authenticated'),
  ('is_league_admin_for_event', 'anon'), ('is_league_admin_for_event', 'authenticated'),
  ('is_tournament_admin', 'anon'), ('is_tournament_admin', 'authenticated'),
  ('get_frame_results_for_match', 'anon'), ('get_frame_results_for_match', 'authenticated'),
  ('get_frame_counts_for_matches', 'anon'), ('get_frame_counts_for_matches', 'authenticated'),
  ('get_user_id_by_email', 'authenticated'),
  ('get_user_email_by_id', 'authenticated');
GRANT SELECT ON client_callable TO anon, authenticated;

SELECT is_empty(
  $$
    SELECT r.role || ' -> ' || p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
    WHERE n.nspname = 'public'
      AND has_function_privilege(r.role, p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM client_callable c WHERE c.proname = p.proname AND c.role = r.role
      )
  $$,
  'clients can execute only allowlisted public functions'
);

SELECT is_empty(
  $$
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN client_callable c ON c.proname = p.proname
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND c.proname NOT IN ('get_user_id_by_email', 'get_user_email_by_id',
                            'is_league_admin', 'is_league_admin_for_event', 'is_tournament_admin')
  $$,
  'client-callable read helpers are SECURITY INVOKER'
);

-- Findings F1–F3, explicitly
SELECT function_privs_are('public', 'rollback_bracket_transition', ARRAY['uuid'], 'anon', ARRAY[]::text[]);
SELECT function_privs_are('public', 'rollback_bracket_transition', ARRAY['uuid'], 'authenticated', ARRAY[]::text[]);
SELECT function_privs_are('public', 'transition_event_to_bracket', ARRAY['uuid', 'jsonb', 'jsonb', 'integer'], 'authenticated', ARRAY[]::text[]);
SELECT function_privs_are('public', 'update_bracket_match_score', ARRAY['integer', 'integer', 'jsonb', 'jsonb'], 'anon', ARRAY[]::text[]);
SELECT function_privs_are('public', 'assign_lane_to_match', ARRAY['uuid', 'uuid', 'integer'], 'anon', ARRAY[]::text[]);
SELECT function_privs_are('public', 'release_match_lane', ARRAY['uuid', 'uuid', 'integer'], 'anon', ARRAY[]::text[]);
SELECT function_privs_are('public', 'bulk_assign_lanes_to_matches', ARRAY['uuid', 'jsonb'], 'anon', ARRAY[]::text[]);
SELECT function_privs_are('public', 'bulk_upsert_frame_results', ARRAY['jsonb'], 'anon', ARRAY[]::text[]);
SELECT function_privs_are('public', 'upsert_frame_result_atomic', ARRAY['uuid', 'uuid', 'integer', 'integer', 'integer'], 'anon', ARRAY[]::text[]);
SELECT hasnt_function('public', 'trigger_sync_bracket_match_scores', ARRAY[]::text[], 'legacy score trigger function was removed');
SELECT hasnt_function('public', 'sync_bracket_match_scores', ARRAY['integer'], 'legacy score sync function was removed');
SELECT hasnt_function('public', 'calculate_bracket_match_scores', ARRAY['integer'], 'legacy score calculation function was removed');
SELECT function_privs_are('public', 'get_pfa_scores_bulk', ARRAY['uuid[]', 'timestamp with time zone'], 'anon', ARRAY[]::text[]);
SELECT function_privs_are('public', 'get_scoring_bracket_matches', ARRAY['uuid'], 'anon', ARRAY[]::text[]);
SELECT function_privs_are('public', 'set_lane_idle', ARRAY['uuid', 'uuid'], 'authenticated', ARRAY[]::text[]);
SELECT function_privs_are('public', 'set_lane_maintenance', ARRAY['uuid', 'uuid'], 'authenticated', ARRAY[]::text[]);
SELECT function_privs_are('public', 'rate_limit_hit', ARRAY['text', 'integer', 'boolean'], 'anon', ARRAY[]::text[]);

-- RLS helpers must stay executable or every RLS-protected read fails
SELECT function_privs_are('public', 'is_league_admin', ARRAY['uuid', 'uuid'], 'anon', ARRAY['EXECUTE']);
SELECT function_privs_are('public', 'is_league_admin_for_event', ARRAY['uuid'], 'anon', ARRAY['EXECUTE']);
SELECT function_privs_are('public', 'is_tournament_admin', ARRAY['uuid'], 'authenticated', ARRAY['EXECUTE']);

-- The server (service role) can still call business functions
SELECT ok(
  has_function_privilege('service_role', 'public.rollback_bracket_transition(uuid)', 'EXECUTE'),
  'service_role can execute business functions'
);

-- New functions start revoked
CREATE FUNCTION public.zz_lockdown_probe() RETURNS int LANGUAGE sql AS 'SELECT 1';
SELECT ok(
  NOT has_function_privilege('anon', 'public.zz_lockdown_probe()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.zz_lockdown_probe()', 'EXECUTE'),
  'functions created later are not executable by clients'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

SELECT is_empty(
  $$
    SELECT r.role || ' -> ' || c.relname || ' ' || priv
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
    CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS priv
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND has_table_privilege(r.role, c.oid, priv)
  $$,
  'clients have no write privileges on any public table'
);

SELECT is_empty(
  $$
    SELECT r.role || ' -> ' || c.relname || '.' || a.attname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
    WHERE n.nspname = 'public'
      AND (has_column_privilege(r.role, c.oid, a.attnum, 'INSERT')
        OR has_column_privilege(r.role, c.oid, a.attnum, 'UPDATE'))
  $$,
  'clients have no column-level write privileges'
);

SELECT is_empty(
  $$
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  $$,
  'every public table has RLS enabled'
);

SELECT table_privs_are('public', 'bracket_match', 'anon', ARRAY['SELECT']);
SELECT table_privs_are('public', 'frame_results', 'anon', ARRAY['SELECT']);
SELECT table_privs_are('public', 'league_admins', 'authenticated', ARRAY['SELECT']);
SELECT table_privs_are('public', 'rate_limits', 'anon', ARRAY[]::text[]);
SELECT table_privs_are('public', 'rate_limits', 'authenticated', ARRAY[]::text[]);

SELECT is_empty(
  $$ SELECT tablename || ': ' || policyname FROM pg_policies
     WHERE schemaname = 'public' AND cmd <> 'SELECT' $$,
  'no write policies remain'
);

-- New tables start with no client privileges
CREATE TABLE public.zz_lockdown_probe (id int);
SELECT table_privs_are('public', 'zz_lockdown_probe', 'anon', ARRAY[]::text[]);
SELECT table_privs_are('public', 'zz_lockdown_probe', 'authenticated', ARRAY[]::text[]);

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

SELECT column_privs_are('public', 'events', 'access_code', 'anon', ARRAY[]::text[]);
SELECT column_privs_are('public', 'events', 'access_code', 'authenticated', ARRAY[]::text[]);
SELECT column_privs_are('public', 'events', 'status', 'anon', ARRAY['SELECT']);
SELECT column_privs_are('public', 'players', 'email', 'anon', ARRAY[]::text[]);
SELECT column_privs_are('public', 'players', 'email', 'authenticated', ARRAY[]::text[]);
SELECT column_privs_are('public', 'players', 'full_name', 'authenticated', ARRAY['SELECT']);
SELECT column_privs_are('public', 'event_players', 'payment_type', 'anon', ARRAY[]::text[]);
SELECT column_privs_are('public', 'event_players', 'payment_type', 'authenticated', ARRAY[]::text[]);
SELECT column_privs_are('public', 'event_players', 'pool', 'authenticated', ARRAY['SELECT']);

-- ---------------------------------------------------------------------------
-- Behaviour as real client roles
-- ---------------------------------------------------------------------------

-- Fixtures (as postgres): an owner and an admin of league L, one bracket event
INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('00000000-0000-0000-0000-00000000a001', 'owner@lockdown.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a002', 'admin@lockdown.test', 'authenticated', 'authenticated');

INSERT INTO public.leagues (id, name) VALUES ('00000000-0000-0000-0000-00000000b001', 'Lockdown League');
INSERT INTO public.league_admins (league_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'owner'),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a002', 'admin');

INSERT INTO public.events (id, league_id, event_date, lane_count, putt_distance_ft, access_code, status)
VALUES ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001',
        '2026-01-01', 2, 25, 'lockdown1', 'bracket');

SELECT throws_ok(
  $$ UPDATE public.events SET access_code = 'MixedCase' WHERE id = '00000000-0000-0000-0000-00000000c001' $$,
  '23514', NULL,
  'access codes must be stored normalized'
);

-- anon
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT throws_ok(
  $$ SELECT access_code FROM public.events $$,
  '42501', NULL, 'anon cannot read events.access_code'
);
SELECT throws_ok(
  $$ SELECT id FROM public.events WHERE access_code = 'lockdown1' $$,
  '42501', NULL, 'anon cannot filter on events.access_code'
);
SELECT ok(
  (SELECT count(*) FROM public.events WHERE id = '00000000-0000-0000-0000-00000000c001') = 1,
  'anon can still read public event columns'
);
SELECT ok(
  (SELECT count(*) FROM public.leagues WHERE id = '00000000-0000-0000-0000-00000000b001') = 1,
  'anon can read leagues'
);
SELECT throws_ok(
  $$ UPDATE public.bracket_match SET status = 4 $$,
  '42501', NULL, 'anon cannot update bracket_match'
);
SELECT throws_ok(
  $$ INSERT INTO public.frame_results (match_frame_id, event_player_id, putts_made, points_earned)
     VALUES (gen_random_uuid(), gen_random_uuid(), 3, 4) $$,
  '42501', NULL, 'anon cannot insert frame_results'
);
SELECT throws_ok(
  $$ SELECT public.rollback_bracket_transition('00000000-0000-0000-0000-00000000c001') $$,
  '42501', NULL, 'anon cannot roll back a bracket'
);
SELECT lives_ok(
  $$ SELECT * FROM public.get_frame_counts_for_matches(ARRAY[1, 2]) $$,
  'anon can call the frame count read helper'
);
RESET ROLE;

-- authenticated, as the non-owner admin
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000a002"}', true);

SELECT throws_ok(
  $$ UPDATE public.league_admins SET role = 'owner'
     WHERE user_id = '00000000-0000-0000-0000-00000000a002' $$,
  '42501', NULL, 'an admin cannot promote themselves to owner (F7)'
);
SELECT throws_ok(
  $$ DELETE FROM public.league_admins WHERE role = 'owner' $$,
  '42501', NULL, 'an admin cannot delete the owner row'
);
SELECT throws_ok(
  $$ SELECT email FROM public.players $$,
  '42501', NULL, 'authenticated users cannot read player emails (F8)'
);
SELECT throws_ok(
  $$ SELECT access_code FROM public.events $$,
  '42501', NULL, 'even a league admin cannot read access codes directly'
);
SELECT throws_ok(
  $$ SELECT public.transition_event_to_bracket('00000000-0000-0000-0000-00000000c001', '[]'::jsonb, '[]'::jsonb, 0) $$,
  '42501', NULL, 'authenticated cannot call transition_event_to_bracket (F3)'
);
SELECT throws_ok(
  $$ INSERT INTO public.leagues (name) VALUES ('Sneaky') $$,
  '42501', NULL, 'authenticated cannot insert leagues directly'
);
SELECT ok(
  (SELECT count(*) FROM public.league_admins WHERE league_id = '00000000-0000-0000-0000-00000000b001') = 2,
  'admins can still read their league admins through RLS'
);
SELECT is(
  public.get_user_email_by_id('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001'),
  'owner@lockdown.test',
  'get_user_email_by_id still works for a league admin'
);
RESET ROLE;

-- service role: the server's writer
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$ UPDATE public.events SET location = 'Server write' WHERE id = '00000000-0000-0000-0000-00000000c001' $$,
  'service_role can write'
);
SELECT is(
  (SELECT count FROM public.rate_limit_hit('lockdown-test', 60000)),
  1,
  'rate_limit_hit starts a window at 1'
);
SELECT is(
  (SELECT count FROM public.rate_limit_hit('lockdown-test', 60000)),
  2,
  'rate_limit_hit increments within the window'
);
SELECT is(
  (SELECT count FROM public.rate_limit_hit('lockdown-test', 60000, false)),
  2,
  'rate_limit_hit can read without counting'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
