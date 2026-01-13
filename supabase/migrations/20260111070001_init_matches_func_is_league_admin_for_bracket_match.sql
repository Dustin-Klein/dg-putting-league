CREATE OR REPLACE FUNCTION public.is_league_admin_for_bracket_match(bracket_match_id_param integer)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bracket_match bm
    JOIN public.events e ON e.id = bm.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE bm.id = bracket_match_id_param
      AND la.user_id = auth.uid()
      AND la.role IN ('owner', 'admin')
  );
$$;
