-- ============================================================================
-- Retire plpgsql business functions (plan 04 §4)
--
-- Every flow these served now runs in the Next.js server as a Drizzle
-- transaction (lib/services, lib/repositories/*.db.ts), with authorization in
-- lib/services/auth. The database keeps constraints, indexes and read-only RLS.
--
-- Kept: is_league_admin, is_league_admin_for_event and is_tournament_admin,
-- which the SELECT policies use. Those policies still serve Realtime and any
-- direct browser read: admin pages subscribe to their own events before they are
-- public, so the admin branches stay.
--
-- The sync/calculate score functions and their trigger were dropped by
-- 202610090000000_score_override.sql (plan 03 T1).
-- Rollback: supabase/rollbacks/202610120000000_retire_rpc_functions.down.sql
-- ============================================================================

-- Bracket, lane and scoring flows (now transactional services)
DROP FUNCTION IF EXISTS public.transition_event_to_bracket(uuid, jsonb, jsonb, integer);
DROP FUNCTION IF EXISTS public.rollback_bracket_transition(uuid);
DROP FUNCTION IF EXISTS public.update_bracket_match_score(integer, integer, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.assign_lane_to_match(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.release_match_lane(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.bulk_assign_lanes_to_matches(uuid, jsonb);
DROP FUNCTION IF EXISTS public.set_lane_maintenance(uuid, uuid);
DROP FUNCTION IF EXISTS public.set_lane_idle(uuid, uuid);
DROP FUNCTION IF EXISTS public.upsert_frame_result_atomic(uuid, uuid, integer, integer, integer);
DROP FUNCTION IF EXISTS public.bulk_upsert_frame_results(jsonb);

-- Reads (now Drizzle queries). get_league_*_counts and get_scoring_bracket_matches
-- had no callers.
DROP FUNCTION IF EXISTS public.get_scoring_bracket_matches(uuid);
DROP FUNCTION IF EXISTS public.get_frame_results_for_match(integer);
DROP FUNCTION IF EXISTS public.get_frame_counts_for_matches(integer[]);
DROP FUNCTION IF EXISTS public.get_pfa_scores_bulk(uuid[], timestamptz);
DROP FUNCTION IF EXISTS public.get_league_event_counts(uuid[]);
DROP FUNCTION IF EXISTS public.get_league_active_event_counts(uuid[], text);

-- Account lookups (now app_private.user_emails, 202610110000000)
DROP FUNCTION IF EXISTS public.get_user_id_by_email(uuid, text);
DROP FUNCTION IF EXISTS public.get_user_email_by_id(uuid, uuid);

-- Authorization helpers no policy uses any more (lib/services/auth does these checks)
DROP FUNCTION IF EXISTS public.is_any_league_admin(uuid);
DROP FUNCTION IF EXISTS public.is_league_admin_for_bracket_match(integer);
DROP FUNCTION IF EXISTS public.is_league_admin_for_match_frame(uuid);
DROP FUNCTION IF EXISTS public.is_league_owner(uuid, uuid);
DROP FUNCTION IF EXISTS public.league_has_no_admins(uuid);

-- Rate limiting is one upsert in lib/repositories/rate-limit-repository.db.ts
DROP FUNCTION IF EXISTS public.rate_limit_hit(text, integer, boolean);

-- app_server bypasses RLS and calls no functions any more.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM app_server;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM app_server;
