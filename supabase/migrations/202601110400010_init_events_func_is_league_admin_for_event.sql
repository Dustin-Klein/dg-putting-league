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
      AND la.role IN ('owner', 'admin')
  );
$$;
