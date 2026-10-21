-- Security lockdown tests (plan 01). Run with: supabase test db
--
-- Clients (anon, authenticated) may only read, through RLS. They can't write any
-- table, read access codes or emails, or execute business functions.
--
-- Covers both schemas: public (shared player identity) and putting_league (this app).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = putting_league, public, extensions;

SELECT no_plan();

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Every function a client can execute must be on this allowlist.
CREATE TEMP TABLE client_callable (proname text, role text);
INSERT INTO client_callable VALUES
  ('is_league_admin', 'anon'), ('is_league_admin', 'authenticated'),
  ('is_league_admin_for_event', 'anon'), ('is_league_admin_for_event', 'authenticated'),
  ('is_tournament_admin', 'anon'), ('is_tournament_admin', 'authenticated');
GRANT SELECT ON client_callable TO anon, authenticated;

SELECT is_empty(
  $$
    SELECT r.role || ' -> ' || p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
    WHERE n.nspname IN ('public', 'putting_league')
      AND has_function_privilege(r.role, p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM client_callable c WHERE c.proname = p.proname AND c.role = r.role
      )
  $$,
  'clients can execute only allowlisted functions'
);

SELECT is_empty(
  $$
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN client_callable c ON c.proname = p.proname
    WHERE n.nspname IN ('public', 'putting_league')
      AND p.prosecdef
      AND c.proname NOT IN ('is_league_admin', 'is_league_admin_for_event', 'is_tournament_admin')
  $$,
  'client-callable read helpers are SECURITY INVOKER'
);

-- Findings F1–F3: business logic moved to the server (plan 04); these functions are gone.
SELECT hasnt_function('public', 'transition_event_to_bracket', ARRAY['uuid', 'jsonb', 'jsonb', 'integer']);
SELECT hasnt_function('public', 'rollback_bracket_transition', ARRAY['uuid']);
SELECT hasnt_function('public', 'update_bracket_match_score', ARRAY['integer', 'integer', 'jsonb', 'jsonb']);
SELECT hasnt_function('public', 'assign_lane_to_match', ARRAY['uuid', 'uuid', 'integer']);
SELECT hasnt_function('public', 'release_match_lane', ARRAY['uuid', 'uuid', 'integer']);
SELECT hasnt_function('public', 'bulk_assign_lanes_to_matches', ARRAY['uuid', 'jsonb']);
SELECT hasnt_function('public', 'set_lane_maintenance', ARRAY['uuid', 'uuid']);
SELECT hasnt_function('public', 'set_lane_idle', ARRAY['uuid', 'uuid']);
SELECT hasnt_function('public', 'upsert_frame_result_atomic', ARRAY['uuid', 'uuid', 'integer', 'integer', 'integer']);
SELECT hasnt_function('public', 'bulk_upsert_frame_results', ARRAY['jsonb']);
SELECT hasnt_function('public', 'get_scoring_bracket_matches', ARRAY['uuid']);
SELECT hasnt_function('public', 'get_frame_results_for_match', ARRAY['integer']);
SELECT hasnt_function('public', 'get_frame_counts_for_matches', ARRAY['integer[]']);
SELECT hasnt_function('public', 'get_pfa_scores_bulk', ARRAY['uuid[]', 'timestamp with time zone']);
SELECT hasnt_function('public', 'get_league_event_counts', ARRAY['uuid[]']);
SELECT hasnt_function('public', 'get_league_active_event_counts', ARRAY['uuid[]', 'text']);
SELECT hasnt_function('public', 'get_user_id_by_email', ARRAY['uuid', 'text']);
SELECT hasnt_function('public', 'get_user_email_by_id', ARRAY['uuid', 'uuid']);
SELECT hasnt_function('public', 'is_any_league_admin', ARRAY['uuid']);
SELECT hasnt_function('public', 'is_league_admin_for_bracket_match', ARRAY['integer']);
SELECT hasnt_function('public', 'is_league_admin_for_match_frame', ARRAY['uuid']);
SELECT hasnt_function('public', 'is_league_owner', ARRAY['uuid', 'uuid']);
SELECT hasnt_function('public', 'league_has_no_admins', ARRAY['uuid']);
SELECT hasnt_function('public', 'rate_limit_hit', ARRAY['text', 'integer', 'boolean']);
SELECT hasnt_function('public', 'trigger_sync_bracket_match_scores', ARRAY[]::text[], 'legacy score trigger function was removed');
SELECT hasnt_function('public', 'sync_bracket_match_scores', ARRAY['integer'], 'legacy score sync function was removed');
SELECT hasnt_function('public', 'calculate_bracket_match_scores', ARRAY['integer'], 'legacy score calculation function was removed');

SELECT function_privs_are('putting_league', 'is_league_admin', ARRAY['uuid', 'uuid'], 'anon', ARRAY['EXECUTE']);
SELECT function_privs_are('putting_league', 'is_league_admin_for_event', ARRAY['uuid'], 'anon', ARRAY['EXECUTE']);
SELECT function_privs_are('putting_league', 'is_tournament_admin', ARRAY['uuid'], 'authenticated', ARRAY['EXECUTE']);

-- The RLS helpers moved with the league tables and resolve names in their own schema
SELECT hasnt_function('public', 'is_league_admin', ARRAY['uuid', 'uuid']);
SELECT hasnt_function('public', 'is_league_admin_for_event', ARRAY['uuid']);
SELECT hasnt_function('public', 'is_tournament_admin', ARRAY['uuid']);
SELECT is_empty(
  $$
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'putting_league'
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) cfg
        WHERE cfg = 'search_path=putting_league, public, pg_temp'
      )
  $$,
  'putting_league definer functions pin search_path'
);

-- The server role calls no functions: it bypasses RLS and does its own authorization
SELECT is_empty(
  $$
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'putting_league')
      AND has_function_privilege('app_server', p.oid, 'EXECUTE')
  $$,
  'app_server can execute no functions'
);

-- app_server reads account emails only through app_private.user_emails
SELECT ok(
  has_table_privilege('app_server', 'app_private.user_emails', 'SELECT')
  AND NOT has_table_privilege('anon', 'app_private.user_emails', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'app_private.user_emails', 'SELECT'),
  'only app_server can read account emails'
);
SELECT ok(
  NOT has_schema_privilege('anon', 'app_private', 'USAGE')
  AND NOT has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'clients cannot use the app_private schema'
);

-- New functions start revoked
CREATE FUNCTION public.zz_lockdown_probe() RETURNS int LANGUAGE sql AS 'SELECT 1';
CREATE FUNCTION putting_league.zz_lockdown_probe() RETURNS int LANGUAGE sql AS 'SELECT 1';
SELECT ok(
  NOT has_function_privilege('anon', 'public.zz_lockdown_probe()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.zz_lockdown_probe()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'putting_league.zz_lockdown_probe()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'putting_league.zz_lockdown_probe()', 'EXECUTE'),
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
    WHERE n.nspname IN ('public', 'putting_league')
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND has_table_privilege(r.role, c.oid, priv)
  $$,
  'clients have no write privileges on any table'
);

SELECT is_empty(
  $$
    SELECT r.role || ' -> ' || c.relname || '.' || a.attname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
    WHERE n.nspname IN ('public', 'putting_league')
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
    WHERE n.nspname IN ('public', 'putting_league') AND c.relkind = 'r' AND NOT c.relrowsecurity
  $$,
  'every table has RLS enabled'
);

SELECT table_privs_are('putting_league', 'bracket_match', 'anon', ARRAY['SELECT']);
SELECT table_privs_are('putting_league', 'frame_results', 'anon', ARRAY['SELECT']);
SELECT table_privs_are('putting_league', 'league_admins', 'authenticated', ARRAY['SELECT']);
SELECT table_privs_are('putting_league', 'player_profiles', 'anon', ARRAY['SELECT']);
SELECT table_privs_are('putting_league', 'rate_limits', 'anon', ARRAY[]::text[]);
SELECT table_privs_are('putting_league', 'rate_limits', 'authenticated', ARRAY[]::text[]);

SELECT is_empty(
  $$ SELECT schemaname || '.' || tablename || ': ' || policyname FROM pg_policies
     WHERE schemaname IN ('public', 'putting_league') AND cmd <> 'SELECT' $$,
  'no write policies remain'
);

-- New tables start with no client privileges
CREATE TABLE public.zz_lockdown_probe (id int);
SELECT table_privs_are('public', 'zz_lockdown_probe', 'anon', ARRAY[]::text[]);
SELECT table_privs_are('public', 'zz_lockdown_probe', 'authenticated', ARRAY[]::text[]);
CREATE TABLE putting_league.zz_lockdown_probe (id int);
SELECT table_privs_are('putting_league', 'zz_lockdown_probe', 'anon', ARRAY[]::text[]);
SELECT table_privs_are('putting_league', 'zz_lockdown_probe', 'authenticated', ARRAY[]::text[]);
SELECT table_privs_are('putting_league', 'zz_lockdown_probe', 'app_server', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']);

-- ---------------------------------------------------------------------------
-- Schemas: public is shared player identity; the league lives in putting_league
-- ---------------------------------------------------------------------------

SELECT tables_are('public', ARRAY['players', 'zz_lockdown_probe'], 'public holds only shared player identity');
SELECT hasnt_column('public', 'players', 'default_pool', 'default_pool moved to putting_league.player_profiles');
SELECT fk_ok('putting_league', 'player_profiles', 'player_id', 'public', 'players', 'id');
SELECT fk_ok('putting_league', 'event_players', 'player_id', 'public', 'players', 'id');
SELECT ok(
  has_schema_privilege('app_server', 'putting_league', 'USAGE')
  AND has_schema_privilege('anon', 'putting_league', 'USAGE')
  AND has_schema_privilege('authenticated', 'putting_league', 'USAGE')
  AND NOT has_schema_privilege('anon', 'putting_league', 'CREATE')
  AND NOT has_schema_privilege('authenticated', 'putting_league', 'CREATE'),
  'clients can use putting_league (for Realtime) but not create in it'
);
SELECT set_eq(
  $$ SELECT schemaname || '.' || tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' $$,
  ARRAY['putting_league.bracket_match', 'putting_league.bracket_participant', 'putting_league.frame_results',
        'putting_league.lanes', 'putting_league.match_frames', 'putting_league.qualification_frames'],
  'Realtime publishes the league tables from their new schema'
);

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

SELECT column_privs_are('putting_league', 'events', 'access_code', 'anon', ARRAY[]::text[]);
SELECT column_privs_are('putting_league', 'events', 'access_code', 'authenticated', ARRAY[]::text[]);
SELECT column_privs_are('putting_league', 'events', 'status', 'anon', ARRAY['SELECT']);
SELECT column_privs_are('public', 'players', 'email', 'anon', ARRAY[]::text[]);
SELECT column_privs_are('public', 'players', 'email', 'authenticated', ARRAY[]::text[]);
SELECT column_privs_are('public', 'players', 'full_name', 'authenticated', ARRAY['SELECT']);
SELECT column_privs_are('public', 'players', 'nickname', 'anon', ARRAY['SELECT']);
SELECT column_privs_are('putting_league', 'event_players', 'payment_type', 'anon', ARRAY[]::text[]);
SELECT column_privs_are('putting_league', 'event_players', 'payment_type', 'authenticated', ARRAY[]::text[]);
SELECT column_privs_are('putting_league', 'event_players', 'pool', 'authenticated', ARRAY['SELECT']);

-- ---------------------------------------------------------------------------
-- Behaviour as real client roles
-- ---------------------------------------------------------------------------

-- Fixtures (as postgres): an owner and an admin of league L, one bracket event
INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('00000000-0000-0000-0000-00000000a001', 'owner@lockdown.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a002', 'admin@lockdown.test', 'authenticated', 'authenticated');

INSERT INTO putting_league.leagues (id, name) VALUES ('00000000-0000-0000-0000-00000000b001', 'Lockdown League');
INSERT INTO putting_league.league_admins (league_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'owner'),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a002', 'admin');

INSERT INTO putting_league.events (id, league_id, event_date, lane_count, putt_distance_ft, access_code, status)
VALUES ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001',
        '2026-01-01', 2, 25, 'lockdown1', 'bracket');

SELECT throws_ok(
  $$ UPDATE putting_league.events SET access_code = 'MixedCase' WHERE id = '00000000-0000-0000-0000-00000000c001' $$,
  '23514', NULL,
  'access codes must be stored normalized'
);

-- anon
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT throws_ok(
  $$ SELECT access_code FROM putting_league.events $$,
  '42501', NULL, 'anon cannot read events.access_code'
);
SELECT throws_ok(
  $$ SELECT id FROM putting_league.events WHERE access_code = 'lockdown1' $$,
  '42501', NULL, 'anon cannot filter on events.access_code'
);
SELECT ok(
  (SELECT count(*) FROM putting_league.events WHERE id = '00000000-0000-0000-0000-00000000c001') = 1,
  'anon can still read public event columns'
);
SELECT ok(
  (SELECT count(*) FROM putting_league.leagues WHERE id = '00000000-0000-0000-0000-00000000b001') = 1,
  'anon can read leagues'
);
SELECT throws_ok(
  $$ UPDATE putting_league.bracket_match SET status = 4 $$,
  '42501', NULL, 'anon cannot update bracket_match'
);
SELECT throws_ok(
  $$ INSERT INTO putting_league.frame_results (match_frame_id, event_player_id, putts_made, points_earned)
     VALUES (gen_random_uuid(), gen_random_uuid(), 3, 4) $$,
  '42501', NULL, 'anon cannot insert frame_results'
);
SELECT lives_ok(
  $$ SELECT id FROM putting_league.frame_results LIMIT 1 $$,
  'anon can still read frame results'
);
RESET ROLE;

-- authenticated, as the non-owner admin
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000a002"}', true);

SELECT throws_ok(
  $$ UPDATE putting_league.league_admins SET role = 'owner'
     WHERE user_id = '00000000-0000-0000-0000-00000000a002' $$,
  '42501', NULL, 'an admin cannot promote themselves to owner (F7)'
);
SELECT throws_ok(
  $$ DELETE FROM putting_league.league_admins WHERE role = 'owner' $$,
  '42501', NULL, 'an admin cannot delete the owner row'
);
SELECT throws_ok(
  $$ SELECT email FROM public.players $$,
  '42501', NULL, 'authenticated users cannot read player emails (F8)'
);
SELECT throws_ok(
  $$ SELECT access_code FROM putting_league.events $$,
  '42501', NULL, 'even a league admin cannot read access codes directly'
);
SELECT throws_ok(
  $$ INSERT INTO putting_league.leagues (name) VALUES ('Sneaky') $$,
  '42501', NULL, 'authenticated cannot insert leagues directly'
);
-- The owner's row is visible only through putting_league.is_league_admin, so this
-- also checks the moved helper resolves its tables.
SELECT ok(
  (SELECT count(*) FROM putting_league.league_admins WHERE league_id = '00000000-0000-0000-0000-00000000b001') = 2,
  'admins can still read their league admins through RLS'
);
SELECT throws_ok(
  $$ SELECT email FROM app_private.user_emails $$,
  '42501', NULL, 'even a league admin cannot read account emails'
);
RESET ROLE;

-- app_server: the server's reader and writer (plan 02/04). The test runner can't
-- SET ROLE app_server, so check its privileges directly.
SELECT ok(
  has_table_privilege('app_server', 'putting_league.events', 'UPDATE')
  AND has_table_privilege('app_server', 'putting_league.rate_limits', 'INSERT'),
  'app_server can write league tables'
);

-- Schema cleanup (plan 05 C9/C10): one role model, no dead tables, tighter matches.
SELECT hasnt_table('putting_league', 'player_statistics', 'player_statistics is dropped');
SELECT hasnt_table('putting_league', 'league_stats', 'league_stats is dropped');
SELECT hasnt_table('putting_league', 'event_statistics', 'event_statistics is dropped');
SELECT hasnt_type('putting_league', 'stat_type', 'stat_type is dropped');
SELECT enum_has_labels('putting_league', 'league_admin_role', ARRAY['owner', 'admin'], 'league_admin_role has no scorer');
SELECT col_not_null('putting_league', 'bracket_match', 'event_id', 'bracket_match.event_id is NOT NULL');
SELECT col_has_check('putting_league', 'bracket_match', 'status', 'bracket_match.status has a CHECK constraint');

SELECT * FROM finish();
ROLLBACK;
