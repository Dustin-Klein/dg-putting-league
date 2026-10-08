-- ============================================================================
-- Dedicated database role for the Next.js server (plan 02)
--
-- The server talks to Postgres directly (Drizzle over the Supavisor pooler) so
-- that a service method can run in one real transaction. It logs in as
-- `app_server` rather than `postgres`: DML on public tables, nothing else.
--
-- The role is created WITHOUT a password, so it cannot log in until one is set
-- out-of-band (never in git):
--   ALTER ROLE app_server WITH PASSWORD '<secret>';
-- Locally, supabase/seed.sql sets a throwaway password.
-- Rollback: supabase/rollbacks/202610080000000_app_server_role.down.sql
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_server') THEN
    -- BYPASSRLS: RLS policies only describe what browser roles may read. The
    -- server does its own authorization (lib/services/auth) before touching data.
    CREATE ROLE app_server LOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_server;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_server;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_server;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_server;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_server;

-- Needed while plpgsql business functions still exist: the frame_results score
-- trigger calls sync_bracket_match_scores() as the writing role, and a few reads
-- still go through RPCs. Revisit when plan 04 retires the functions.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_server;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_server;
