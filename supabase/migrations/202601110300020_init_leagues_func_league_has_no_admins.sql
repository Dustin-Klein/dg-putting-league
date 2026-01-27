CREATE OR REPLACE FUNCTION public.league_has_no_admins(league_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_id = league_id_param
  );
$$;
