-- Emergency rollback for 202610210000000_putting_league_schema.sql.
-- Moves everything back to public and restores players.default_pool from
-- putting_league.player_profiles. Deploy the matching app build with it.

-- RLS helpers (bodies name public.* again)
ALTER FUNCTION putting_league.is_league_admin(uuid, uuid) SET SCHEMA public;
ALTER FUNCTION putting_league.is_league_admin_for_event(uuid) SET SCHEMA public;
ALTER FUNCTION putting_league.is_tournament_admin(uuid) SET SCHEMA public;

-- Tables
ALTER TABLE putting_league.leagues SET SCHEMA public;
ALTER TABLE putting_league.league_admins SET SCHEMA public;
ALTER TABLE putting_league.events SET SCHEMA public;
ALTER TABLE putting_league.event_players SET SCHEMA public;
ALTER TABLE putting_league.event_placements SET SCHEMA public;
ALTER TABLE putting_league.qualification_rounds SET SCHEMA public;
ALTER TABLE putting_league.qualification_frames SET SCHEMA public;
ALTER TABLE putting_league.teams SET SCHEMA public;
ALTER TABLE putting_league.team_members SET SCHEMA public;
ALTER TABLE putting_league.lanes SET SCHEMA public;
ALTER TABLE putting_league.match_frames SET SCHEMA public;
ALTER TABLE putting_league.frame_results SET SCHEMA public;
ALTER TABLE putting_league.bracket_stage SET SCHEMA public;
ALTER TABLE putting_league.bracket_group SET SCHEMA public;
ALTER TABLE putting_league.bracket_round SET SCHEMA public;
ALTER TABLE putting_league.bracket_match SET SCHEMA public;
ALTER TABLE putting_league.bracket_match_game SET SCHEMA public;
ALTER TABLE putting_league.bracket_participant SET SCHEMA public;
ALTER TABLE putting_league.rate_limits SET SCHEMA public;

-- Enums
ALTER TYPE putting_league.event_link_type SET SCHEMA public;
ALTER TYPE putting_league.event_status SET SCHEMA public;
ALTER TYPE putting_league.lane_status SET SCHEMA public;
ALTER TYPE putting_league.league_admin_role SET SCHEMA public;
ALTER TYPE putting_league.pool_type SET SCHEMA public;
ALTER TYPE putting_league.qualification_status SET SCHEMA public;
ALTER TYPE putting_league.team_assignment_type SET SCHEMA public;

CREATE OR REPLACE FUNCTION public.is_league_admin(league_id_param uuid, user_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_id = league_id_param
    AND user_id = user_id_param
  );
$$;

CREATE OR REPLACE FUNCTION public.is_league_admin_for_event(event_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE e.id = event_id_param
      AND la.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_tournament_admin(tournament_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_league_admin_for_event(tournament_id_param);
$$;

-- players.default_pool
ALTER TABLE public.players ADD COLUMN default_pool public.pool_type;

UPDATE public.players p
SET default_pool = pp.default_pool
FROM putting_league.player_profiles pp
WHERE pp.player_id = p.id;

GRANT SELECT (default_pool) ON public.players TO anon, authenticated;

DROP TABLE putting_league.player_profiles;

-- Also drops the schema's default privileges (they depend on it).
DROP SCHEMA putting_league;
