CREATE OR REPLACE FUNCTION public.is_tournament_admin(tournament_id_param UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_league_admin_for_event(tournament_id_param);
$$;
