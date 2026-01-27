CREATE OR REPLACE FUNCTION public.is_any_league_admin(user_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE user_id = user_id_param
    AND role IN ('owner', 'admin')
  );
$$;
