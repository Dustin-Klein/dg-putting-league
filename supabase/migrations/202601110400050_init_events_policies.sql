CREATE POLICY "Enable insert for league admins"
ON public.events
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = events.league_id
    AND league_admins.user_id = (select auth.uid())
    AND league_admins.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Enable read for admins or scoring events"
ON public.events
FOR SELECT
TO anon, authenticated
USING (
  status = 'bracket'
  OR (status = 'pre-bracket' AND qualification_round_enabled = true)
  OR EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = events.league_id
    AND league_admins.user_id = (select auth.uid())
  )
);

CREATE POLICY "Enable update for league admins"
ON public.events
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = events.league_id
    AND league_admins.user_id = (select auth.uid())
    AND league_admins.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Enable delete for league owners"
ON public.events
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = events.league_id
    AND league_admins.user_id = (select auth.uid())
    AND league_admins.role = 'owner'
  )
);

CREATE POLICY "Enable read for admins or bracket events"
ON public.lanes FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = lanes.event_id
    AND e.status = 'bracket'
  )
  OR EXISTS (
    SELECT 1 FROM public.events e
    JOIN league_admins la ON la.league_id = e.league_id
    WHERE e.id = lanes.event_id
    AND la.user_id = (select auth.uid())
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.lanes FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    JOIN league_admins la ON la.league_id = e.league_id
    WHERE e.id = lanes.event_id
    AND la.user_id = (select auth.uid())
  )
);

CREATE POLICY "Enable update for league admins"
ON public.lanes FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    JOIN league_admins la ON la.league_id = e.league_id
    WHERE e.id = lanes.event_id
    AND la.user_id = (select auth.uid())
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.lanes FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    JOIN league_admins la ON la.league_id = e.league_id
    WHERE e.id = lanes.event_id
    AND la.user_id = (select auth.uid())
  )
);
