-- ============================================================================
-- Move the putting league into its own schema
--
-- `public` keeps only the player identity every app shares (players and its
-- player_number_seq). Each app owns a schema that references public.players(id)
-- and never another app's schema. The putting league's tables, enums and RLS
-- helpers move to `putting_league`.
--
-- ALTER ... SET SCHEMA only changes catalog metadata: data, indexes, constraints,
-- foreign keys, owned serial sequences, grants, RLS policies and Realtime
-- publication membership are all tracked by OID and move with the object.
-- Function bodies are stored as text, so the RLS helpers are redefined below.
--
-- players.default_pool (A/B pool) is a league setting, not identity, so it moves
-- to putting_league.player_profiles.
--
-- putting_league is not added to PostgREST's exposed schemas (config.toml):
-- the browser reads nothing through PostgREST. anon/authenticated get USAGE only
-- so Realtime can check their SELECT grants and RLS.
--
-- Deploy: app builds from before this change use `public.` names and Realtime
-- filters on schema 'public', so merge when no event is running.
-- Rollback: supabase/rollbacks/202610210000000_putting_league_schema.down.sql
-- ============================================================================

CREATE SCHEMA putting_league;

-- ----------------------------------------------------------------------------
-- 1. Privileges on the schema and on objects created in it later
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA putting_league TO app_server, anon, authenticated;

-- Mirrors 202610080000000_app_server_role.sql: the server role gets DML, nothing else.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA putting_league
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_server;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA putting_league
  GRANT USAGE, SELECT ON SEQUENCES TO app_server;

-- Mirrors the security lockdown: new tables, sequences and functions start with no
-- client privileges. (The PUBLIC EXECUTE default was already revoked globally.)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA putting_league
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA putting_league
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA putting_league
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Enums
-- ----------------------------------------------------------------------------
ALTER TYPE public.event_link_type SET SCHEMA putting_league;
ALTER TYPE public.event_status SET SCHEMA putting_league;
ALTER TYPE public.lane_status SET SCHEMA putting_league;
ALTER TYPE public.league_admin_role SET SCHEMA putting_league;
ALTER TYPE public.pool_type SET SCHEMA putting_league;
ALTER TYPE public.qualification_status SET SCHEMA putting_league;
ALTER TYPE public.team_assignment_type SET SCHEMA putting_league;

-- ----------------------------------------------------------------------------
-- 3. players.default_pool -> putting_league.player_profiles
-- ----------------------------------------------------------------------------
CREATE TABLE putting_league.player_profiles (
  player_id uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  default_pool putting_league.pool_type
);

INSERT INTO putting_league.player_profiles (player_id, default_pool)
SELECT id, default_pool FROM public.players WHERE default_pool IS NOT NULL;

ALTER TABLE putting_league.player_profiles ENABLE ROW LEVEL SECURITY;

-- Clients could read players.default_pool; keep that read.
CREATE POLICY "Public read player profiles"
ON putting_league.player_profiles
FOR SELECT
TO anon, authenticated
USING (true);

GRANT SELECT ON putting_league.player_profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON putting_league.player_profiles TO app_server;

ALTER TABLE public.players DROP COLUMN default_pool;

-- Restate the column grant from the security lockdown without default_pool
-- (dropping the column already removed its privilege; email stays hidden).
REVOKE SELECT ON public.players FROM anon, authenticated;
GRANT SELECT (id, player_number, full_name, nickname, created_at)
ON public.players TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.leagues SET SCHEMA putting_league;
ALTER TABLE public.league_admins SET SCHEMA putting_league;
ALTER TABLE public.events SET SCHEMA putting_league;
ALTER TABLE public.event_players SET SCHEMA putting_league;
ALTER TABLE public.event_placements SET SCHEMA putting_league;
ALTER TABLE public.qualification_rounds SET SCHEMA putting_league;
ALTER TABLE public.qualification_frames SET SCHEMA putting_league;
ALTER TABLE public.teams SET SCHEMA putting_league;
ALTER TABLE public.team_members SET SCHEMA putting_league;
ALTER TABLE public.lanes SET SCHEMA putting_league;
ALTER TABLE public.match_frames SET SCHEMA putting_league;
ALTER TABLE public.frame_results SET SCHEMA putting_league;
ALTER TABLE public.bracket_stage SET SCHEMA putting_league;
ALTER TABLE public.bracket_group SET SCHEMA putting_league;
ALTER TABLE public.bracket_round SET SCHEMA putting_league;
ALTER TABLE public.bracket_match SET SCHEMA putting_league;
ALTER TABLE public.bracket_match_game SET SCHEMA putting_league;
ALTER TABLE public.bracket_participant SET SCHEMA putting_league;
ALTER TABLE public.rate_limits SET SCHEMA putting_league;

-- ----------------------------------------------------------------------------
-- 5. RLS helpers
-- ----------------------------------------------------------------------------
-- Moving keeps each function's OID, so the policies that call them and their
-- EXECUTE grants (anon, authenticated, service_role) are unchanged. The bodies
-- name public.* tables, so they are replaced in place.
ALTER FUNCTION public.is_league_admin(uuid, uuid) SET SCHEMA putting_league;
ALTER FUNCTION public.is_league_admin_for_event(uuid) SET SCHEMA putting_league;
ALTER FUNCTION public.is_tournament_admin(uuid) SET SCHEMA putting_league;

CREATE OR REPLACE FUNCTION putting_league.is_league_admin(league_id_param uuid, user_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = putting_league, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM putting_league.league_admins
    WHERE league_id = league_id_param
    AND user_id = user_id_param
  );
$$;

CREATE OR REPLACE FUNCTION putting_league.is_league_admin_for_event(event_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = putting_league, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM putting_league.events e
    JOIN putting_league.league_admins la ON la.league_id = e.league_id
    WHERE e.id = event_id_param
      AND la.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION putting_league.is_tournament_admin(tournament_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = putting_league, public, pg_temp
AS $$
  SELECT putting_league.is_league_admin_for_event(tournament_id_param);
$$;
