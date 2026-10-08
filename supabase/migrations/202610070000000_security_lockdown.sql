-- ============================================================================
-- Security lockdown (plan 01, phase B)
--
-- After this migration the browser-facing roles (anon, authenticated) can only
-- READ, through RLS. All writes and business RPCs go through the Next.js server
-- using the service-role (secret) key, after the server's own authorization check.
--
-- Deploy only after the app code that uses the privileged client is live
-- (the old app code writes with the anon/authenticated roles and would break).
-- Rollback: supabase/rollbacks/202610070000000_security_lockdown.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Functions: nothing is executable by clients except RLS helper predicates
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
-- The server's role. Supabase already grants this explicitly; restated so revoking
-- PUBLIC can never leave the server unable to call business functions.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- New functions start revoked. The PUBLIC default is global (not per-schema), so it
-- is revoked without IN SCHEMA; anon/authenticated defaults are per-schema grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- RLS policies run as the querying role, so helpers they call must stay executable.
-- (Only these three are referenced by the SELECT policies that remain.)
GRANT EXECUTE ON FUNCTION
  public.is_league_admin(uuid, uuid),
  public.is_league_admin_for_event(uuid),
  public.is_tournament_admin(uuid)
TO anon, authenticated;

-- Read helpers used by public pages: run them with the caller's privileges (RLS applies),
-- so they no longer bypass anything.
ALTER FUNCTION public.get_frame_results_for_match(integer) SECURITY INVOKER;
ALTER FUNCTION public.get_frame_counts_for_matches(integer[]) SECURITY INVOKER;
GRANT EXECUTE ON FUNCTION
  public.get_frame_results_for_match(integer),
  public.get_frame_counts_for_matches(integer[])
TO anon, authenticated;

-- These read auth.users, so they stay SECURITY DEFINER. Each checks auth.uid()
-- against league_admins itself and is called with the signed-in user's client.
GRANT EXECUTE ON FUNCTION
  public.get_user_id_by_email(uuid, text),
  public.get_user_email_by_id(uuid, uuid)
TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Tables: clients get SELECT only (rows still filtered by RLS)
-- ----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- New tables and sequences start with no client privileges; grant explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Column-level read restrictions
-- ----------------------------------------------------------------------------
-- events.access_code is never readable by clients.
REVOKE SELECT ON public.events FROM anon, authenticated;
GRANT SELECT (id, league_id, event_date, location, lane_count, putt_distance_ft, bonus_point_enabled,
  qualification_round_enabled, bracket_frame_count, qualification_frame_count, double_grand_final,
  entry_fee_per_player, admin_fees, admin_fee_per_player, payout_pool_override, payout_structure,
  status, created_at)
ON public.events TO anon, authenticated;

-- players.email is never readable by clients (sign-up is open, so "authenticated" is anyone).
REVOKE SELECT ON public.players FROM anon, authenticated;
GRANT SELECT (id, player_number, full_name, nickname, created_at, default_pool)
ON public.players TO anon, authenticated;

-- event_players.payment_type is admin information (admins read it via the server).
REVOKE SELECT ON public.event_players FROM anon, authenticated;
GRANT SELECT (id, event_id, player_id, pool, qualification_seed, pfa_score, scoring_method, created_at)
ON public.event_players TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Drop every write policy. With no INSERT/UPDATE/DELETE grants they are dead,
--    and keeping them invites confusion. Done dynamically so it also removes
--    policies that drifted from the migration files (e.g. owner-only deletes).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Access codes: stored normalized, matched exactly
-- ----------------------------------------------------------------------------
-- Codes that differ only by case/whitespace would collide on the UNIQUE constraint.
-- Fail with a clear message instead; resolve by changing one of the codes first.
DO $$
DECLARE
  collisions TEXT;
BEGIN
  SELECT string_agg(format('%s (events: %s)', code, ids), '; ')
  INTO collisions
  FROM (
    SELECT lower(trim(access_code)) AS code, string_agg(id::text, ', ') AS ids
    FROM public.events
    GROUP BY 1
    HAVING count(*) > 1
  ) dupes;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION 'Access codes collide after normalization: %', collisions
      USING HINT = 'Change one access code in each group, then re-run this migration.';
  END IF;
END $$;

UPDATE public.events
SET access_code = lower(trim(access_code))
WHERE access_code <> lower(trim(access_code));

ALTER TABLE public.events
  ADD CONSTRAINT access_code_normalized CHECK (access_code = lower(trim(access_code)));

-- ----------------------------------------------------------------------------
-- 6. Public read of leagues (names and cities are not sensitive)
-- ----------------------------------------------------------------------------
CREATE POLICY "Public read leagues"
ON public.leagues
FOR SELECT
TO anon, authenticated
USING (true);

-- ----------------------------------------------------------------------------
-- 7. Shared rate-limit store (server-only; replaces the per-instance in-memory map)
-- ----------------------------------------------------------------------------
CREATE TABLE public.rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_rate_limits_reset_at ON public.rate_limits(reset_at);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: only the service role can touch it.
REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- Count one request against a fixed window and return the window state.
-- p_increment = false reads the current window without counting.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_key TEXT,
  p_window_ms INTEGER,
  p_increment BOOLEAN DEFAULT true
)
RETURNS TABLE (count INTEGER, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Opportunistic cleanup of long-expired windows
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits rl WHERE rl.reset_at < now() - interval '1 hour';
  END IF;

  IF NOT p_increment THEN
    RETURN QUERY
      SELECT rl.count, rl.reset_at
      FROM public.rate_limits rl
      WHERE rl.key = p_key AND rl.reset_at > now();
    RETURN;
  END IF;

  RETURN QUERY
    INSERT INTO public.rate_limits AS rl (key, count, reset_at)
    VALUES (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rl.reset_at <= now() THEN 1 ELSE rl.count + 1 END,
      reset_at = CASE WHEN rl.reset_at <= now() THEN EXCLUDED.reset_at ELSE rl.reset_at END
    RETURNING rl.count, rl.reset_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, BOOLEAN) TO service_role;
