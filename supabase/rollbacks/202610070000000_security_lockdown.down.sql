-- Emergency rollback for 202610070000000_security_lockdown.sql.
-- Not a migration (this folder is not read by the Supabase CLI). Run manually in
-- the SQL editor only if the lockdown breaks production and a fix can't ship quickly.
--
-- This restores client PRIVILEGES only. The dropped write policies are NOT recreated,
-- so with this rollback alone, client writes are still blocked by RLS. The current app
-- does all writes with the service role and doesn't need them. Restoring the old app
-- would also require re-running the policy sections of the init_* migrations.

-- Functions: back to Supabase defaults
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
ALTER FUNCTION public.get_frame_results_for_match(integer) SECURITY DEFINER;
ALTER FUNCTION public.get_frame_counts_for_matches(integer[]) SECURITY DEFINER;

-- Tables and sequences
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;

-- Re-apply the pre-lockdown column restriction on players.email for anon
REVOKE SELECT ON public.players FROM anon;
GRANT SELECT (id, player_number, full_name, nickname, created_at, default_pool) ON public.players TO anon;

-- rate_limits stays server-only
REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- Access codes stay normalized (harmless); the CHECK constraint can stay.
-- The public leagues policy can stay.
