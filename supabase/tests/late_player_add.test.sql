-- Late player add schema tests (substitutions, filled byes, reopened registration). Run with: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = putting_league, public, extensions;

SELECT no_plan();

-- team_member_substitutions: server-only
SELECT table_privs_are('putting_league', 'team_member_substitutions', r, ARRAY[]::text[])
FROM unnest(ARRAY['anon', 'authenticated']) AS r;
SELECT table_privs_are('putting_league', 'team_member_substitutions', 'app_server', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'putting_league.team_member_substitutions'::regclass),
  'team_member_substitutions has RLS enabled'
);

-- bracket_match gains app-owned columns; clients keep reading bracket_match as before.

-- events.reopened_team_draft is not granted to clients (column-level SELECT on events).
SELECT ok(
  NOT has_column_privilege('anon', 'putting_league.events', 'reopened_team_draft', 'SELECT')
    AND NOT has_column_privilege('authenticated', 'putting_league.events', 'reopened_team_draft', 'SELECT'),
  'clients cannot read events.reopened_team_draft'
);

SELECT * FROM finish();
ROLLBACK;
