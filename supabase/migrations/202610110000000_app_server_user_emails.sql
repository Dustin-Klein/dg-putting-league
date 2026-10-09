-- ============================================================================
-- Account lookups for the Next.js server (plan 04)
--
-- League admin management needs to find an account by email and show admins'
-- emails. Those lookups used the get_user_id_by_email / get_user_email_by_id
-- RPCs; the server now does them itself after authorizing the league owner.
--
-- `postgres` can read auth.users but can't grant USAGE on the auth schema, so
-- app_server reads through a view owned by postgres in a schema PostgREST
-- doesn't expose. Only the id and email columns are visible.
-- Rollback: supabase/rollbacks/202610110000000_app_server_user_emails.down.sql
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO app_server;

CREATE VIEW app_private.user_emails AS
  SELECT id, email FROM auth.users;

REVOKE ALL ON app_private.user_emails FROM PUBLIC, anon, authenticated;
GRANT SELECT ON app_private.user_emails TO app_server;
