CREATE POLICY "Enable read for admins or bracket events"
ON public.bracket_match FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_match.event_id
    AND (e.status = 'bracket' OR e.status = 'completed')
  )
  OR EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_match FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable update for admins or bracket scoring"
ON public.bracket_match FOR UPDATE
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_match.event_id
    AND e.status = 'bracket'
  )
  OR EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_match.event_id
    AND e.status = 'bracket'
  )
  OR EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.bracket_match FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable read access for league admins"
ON public.bracket_match_game FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match_game.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_match_game FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match_game.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable update for league admins"
ON public.bracket_match_game FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match_game.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.bracket_match_game FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match_game.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable read for admins or bracket events"
ON public.bracket_participant FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_participant.tournament_id
    AND (e.status = 'bracket' OR e.status = 'completed')
  )
  OR public.is_tournament_admin(tournament_id)
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_participant FOR INSERT
WITH CHECK (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable update for league admins"
ON public.bracket_participant FOR UPDATE
USING (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable delete for league admins"
ON public.bracket_participant FOR DELETE
USING (public.is_tournament_admin(tournament_id));
