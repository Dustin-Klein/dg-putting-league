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

CREATE POLICY "Enable insert for first league admin"
ON public.league_admins
FOR INSERT
WITH CHECK (
  public.league_has_no_admins(league_admins.league_id)
  OR
  public.is_league_admin(league_admins.league_id, (select auth.uid()))
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
