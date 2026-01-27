-- Look up user ID by email (for adding admins)
-- Only callable by league owners to prevent email enumeration
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(league_id_param uuid, email_param text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE u.email = lower(trim(email_param))
    AND EXISTS (
      SELECT 1 FROM public.league_admins la
      WHERE la.league_id = league_id_param
        AND la.user_id = auth.uid()
        AND la.role = 'owner'
    )
  LIMIT 1;
$$;

-- Look up user email by ID (for displaying admin list)
-- Only returns email if caller is an admin of the same league as the target user
CREATE OR REPLACE FUNCTION public.get_user_email_by_id(league_id_param uuid, user_id_param uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.email
  FROM auth.users u
  WHERE u.id = user_id_param
    AND EXISTS (
      SELECT 1 FROM public.league_admins la
      WHERE la.league_id = league_id_param
        AND la.user_id = user_id_param
    )
    AND EXISTS (
      SELECT 1 FROM public.league_admins la
      WHERE la.league_id = league_id_param
        AND la.user_id = auth.uid()
    )
  LIMIT 1;
$$;

-- Check if user is the league owner (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_league_owner(league_id_param uuid, user_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_id = league_id_param
    AND user_id = user_id_param
    AND role = 'owner'
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_email_by_id(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_league_owner(uuid, uuid) TO authenticated;

CREATE POLICY "Enable insert for authenticated users"
ON public.leagues
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable read access for league admins"
ON public.leagues
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = leagues.id
    AND league_admins.user_id = (select auth.uid())
  )
);

CREATE POLICY "Enable update for league admins"
ON public.leagues
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = leagues.id
    AND league_admins.user_id = (select auth.uid())
    AND league_admins.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Enable delete for league owners"
ON public.leagues
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = leagues.id
    AND league_admins.user_id = (select auth.uid())
    AND league_admins.role = 'owner'
  )
);

CREATE POLICY "Enable read access for league admins"
ON public.league_admins
FOR SELECT
USING (
  user_id = (select auth.uid())
  OR public.is_league_admin(league_id, (select auth.uid()))
);

CREATE POLICY "Enable insert for first league admin or owner"
ON public.league_admins
FOR INSERT
WITH CHECK (
  public.league_has_no_admins(league_admins.league_id)
  OR
  public.is_league_owner(league_admins.league_id, (select auth.uid()))
);

CREATE POLICY "Enable update for own record"
ON public.league_admins
FOR UPDATE
USING (user_id = (select auth.uid()))
WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Enable delete for own record"
ON public.league_admins
FOR DELETE
USING (user_id = (select auth.uid()) OR public.is_league_admin(league_id, (select auth.uid())));

CREATE POLICY "Enable insert for league admins"
ON public.players
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_any_league_admin((select auth.uid()))
);
