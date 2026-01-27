CREATE POLICY "Enable read for admins or bracket events"
ON public.bracket_stage FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_stage.tournament_id
    AND e.status = 'bracket'
  )
  OR public.is_tournament_admin(tournament_id)
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_stage FOR INSERT
WITH CHECK (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable update for league admins"
ON public.bracket_stage FOR UPDATE
USING (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable delete for league admins"
ON public.bracket_stage FOR DELETE
USING (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable read for admins or bracket events"
ON public.bracket_group FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    JOIN public.events e ON e.id = s.tournament_id
    WHERE s.id = bracket_group.stage_id
    AND e.status = 'bracket'
  )
  OR EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_group.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_group FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_group.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable update for league admins"
ON public.bracket_group FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_group.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.bracket_group FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_group.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable read for admins or bracket events"
ON public.bracket_round FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    JOIN public.events e ON e.id = s.tournament_id
    WHERE s.id = bracket_round.stage_id
    AND e.status = 'bracket'
  )
  OR EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_round.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_round FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_round.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable update for league admins"
ON public.bracket_round FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_round.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.bracket_round FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_round.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable read for all"
ON public.event_placements FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Enable insert for league admins"
ON public.event_placements FOR INSERT
WITH CHECK (public.is_league_admin_for_event(event_id));

CREATE POLICY "Enable update for league admins"
ON public.event_placements FOR UPDATE
USING (public.is_league_admin_for_event(event_id));

CREATE POLICY "Enable delete for league admins"
ON public.event_placements FOR DELETE
USING (public.is_league_admin_for_event(event_id));
