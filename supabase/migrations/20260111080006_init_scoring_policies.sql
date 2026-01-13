CREATE TRIGGER trigger_frame_results_sync_scores
AFTER INSERT OR UPDATE OR DELETE ON public.frame_results
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_bracket_match_scores();

CREATE POLICY "Enable read for admins or bracket events"
ON public.match_frames
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_match bm
    JOIN public.events e ON e.id = bm.event_id
    WHERE bm.id = match_frames.bracket_match_id
    AND e.status = 'bracket'
  )
  OR EXISTS (
    SELECT 1 FROM public.bracket_match bm
    JOIN public.events e ON e.id = bm.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE bm.id = match_frames.bracket_match_id
    AND la.user_id = (select auth.uid())
  )
);

CREATE POLICY "Enable insert for admins or bracket scoring"
ON public.match_frames
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bracket_match bm
    JOIN public.events e ON e.id = bm.event_id
    WHERE bm.id = match_frames.bracket_match_id
    AND e.status = 'bracket'
  )
  OR public.is_league_admin_for_bracket_match(match_frames.bracket_match_id)
);

CREATE POLICY "Enable update for league admins"
ON public.match_frames
FOR UPDATE
USING (
  public.is_league_admin_for_bracket_match(match_frames.bracket_match_id)
);

CREATE POLICY "Enable delete for league admins"
ON public.match_frames
FOR DELETE
USING (
  public.is_league_admin_for_bracket_match(match_frames.bracket_match_id)
);

CREATE POLICY "Enable read for admins or bracket events"
ON public.frame_results
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.bracket_match bm ON bm.id = mf.bracket_match_id
    JOIN public.events e ON e.id = bm.event_id
    WHERE mf.id = frame_results.match_frame_id
    AND e.status = 'bracket'
  )
  OR EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.bracket_match bm ON bm.id = mf.bracket_match_id
    JOIN public.events e ON e.id = bm.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE mf.id = frame_results.match_frame_id
    AND la.user_id = (select auth.uid())
  )
);

CREATE POLICY "Enable insert for admins or bracket scoring"
ON public.frame_results
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.bracket_match bm ON bm.id = mf.bracket_match_id
    JOIN public.events e ON e.id = bm.event_id
    WHERE mf.id = frame_results.match_frame_id
    AND e.status = 'bracket'
  )
  OR public.is_league_admin_for_match_frame(frame_results.match_frame_id)
);

CREATE POLICY "Enable update for admins or bracket scoring"
ON public.frame_results
FOR UPDATE
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.bracket_match bm ON bm.id = mf.bracket_match_id
    JOIN public.events e ON e.id = bm.event_id
    WHERE mf.id = frame_results.match_frame_id
    AND e.status = 'bracket'
  )
  OR public.is_league_admin_for_match_frame(frame_results.match_frame_id)
);

CREATE POLICY "Enable delete for league admins"
ON public.frame_results
FOR DELETE
USING (
  public.is_league_admin_for_match_frame(frame_results.match_frame_id)
);

CREATE POLICY "Enable public read for player statistics"
ON public.player_statistics FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Enable insert for league admins"
ON public.player_statistics FOR INSERT TO authenticated
WITH CHECK (public.is_league_admin(league_id, (select auth.uid())));

CREATE POLICY "Enable update for league admins"
ON public.player_statistics FOR UPDATE TO authenticated
USING (public.is_league_admin(league_id, (select auth.uid())));

CREATE POLICY "Enable delete for league admins"
ON public.player_statistics FOR DELETE TO authenticated
USING (public.is_league_admin(league_id, (select auth.uid())));

CREATE POLICY "Enable public read for league stats"
ON public.league_stats FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Enable insert for league admins"
ON public.league_stats FOR INSERT TO authenticated
WITH CHECK (public.is_league_admin(league_id, (select auth.uid())));

CREATE POLICY "Enable update for league admins"
ON public.league_stats FOR UPDATE TO authenticated
USING (public.is_league_admin(league_id, (select auth.uid())));

CREATE POLICY "Enable delete for league admins"
ON public.league_stats FOR DELETE TO authenticated
USING (public.is_league_admin(league_id, (select auth.uid())));

CREATE POLICY "Enable public read for event statistics"
ON public.event_statistics FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Enable insert for league admins"
ON public.event_statistics FOR INSERT TO authenticated
WITH CHECK (public.is_league_admin_for_event(event_id));

CREATE POLICY "Enable update for league admins"
ON public.event_statistics FOR UPDATE TO authenticated
USING (public.is_league_admin_for_event(event_id));

CREATE POLICY "Enable delete for league admins"
ON public.event_statistics FOR DELETE TO authenticated
USING (public.is_league_admin_for_event(event_id));
