CREATE OR REPLACE FUNCTION public.is_league_admin_for_match_frame(match_frame_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.match_frames mf
    JOIN public.bracket_match bm ON bm.id = mf.bracket_match_id
    JOIN public.events e ON e.id = bm.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE mf.id = match_frame_id_param
      AND la.user_id = auth.uid()
      AND la.role IN ('owner', 'admin')
  );
$$;
