-- Migration to enable public access for scoring
-- This allows unauthenticated users to score matches for events in bracket status

-- Security definer function to get bracket matches for an event (for public scoring)
CREATE OR REPLACE FUNCTION public.get_scoring_bracket_matches(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT json_agg(
      json_build_object(
        'id', bm.id,
        'status', bm.status,
        'round_id', bm.round_id,
        'number', bm.number
      )
    )
    FROM public.bracket_match bm
    WHERE bm.event_id = p_event_id
    AND bm.status IN (2, 3) -- Ready = 2, Running = 3
  );
END;
$$;

-- Add RLS policies for public scoring access
-- These allow anon AND authenticated users to read data needed for scoring when they have a valid access code

-- Policy for bracket_match: allow public read for matches in events with bracket status
CREATE POLICY "Enable public read for bracket scoring"
ON public.bracket_match
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_match.event_id
    AND e.status = 'bracket'
  )
);

-- Policy for match table: allow public read/write for matches in events with bracket status
CREATE POLICY "Enable public read for match scoring"
ON public.match
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = match.event_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable public insert for match scoring"
ON public.match
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = match.event_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable public update for match scoring"
ON public.match
FOR UPDATE
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = match.event_id
    AND e.status = 'bracket'
  )
);

-- Policy for match_frames: allow public read/write for frames in bracket matches
CREATE POLICY "Enable public read for frame scoring"
ON public.match_frames
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.match m
    JOIN public.events e ON e.id = m.event_id
    WHERE m.id = match_frames.match_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable public insert for frame scoring"
ON public.match_frames
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.match m
    JOIN public.events e ON e.id = m.event_id
    WHERE m.id = match_frames.match_id
    AND e.status = 'bracket'
  )
);

-- Policy for frame_results: allow public read/write for results in bracket matches
CREATE POLICY "Enable public read for result scoring"
ON public.frame_results
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.match m ON m.id = mf.match_id
    JOIN public.events e ON e.id = m.event_id
    WHERE mf.id = frame_results.match_frame_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable public insert for result scoring"
ON public.frame_results
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.match m ON m.id = mf.match_id
    JOIN public.events e ON e.id = m.event_id
    WHERE mf.id = frame_results.match_frame_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable public update for result scoring"
ON public.frame_results
FOR UPDATE
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.match m ON m.id = mf.match_id
    JOIN public.events e ON e.id = m.event_id
    WHERE mf.id = frame_results.match_frame_id
    AND e.status = 'bracket'
  )
);

-- Policy for teams: allow public read for teams in events with bracket status
CREATE POLICY "Enable public read for teams in bracket"
ON public.teams
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = teams.event_id
    AND e.status = 'bracket'
  )
);

-- Policy for team_members: allow public read for team members in events with bracket status
CREATE POLICY "Enable public read for team members in bracket"
ON public.team_members
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.id = team_members.team_id
    AND e.status = 'bracket'
  )
);

-- Policy for event_players: allow public read for event players in events with bracket status
CREATE POLICY "Enable public read for event players in bracket"
ON public.event_players
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_players.event_id
    AND e.status = 'bracket'
  )
);

-- Policy for players: allow anon to read player info (names for display)
-- Players table doesn't have RLS enabled yet, so we need to enable it first
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable public read for players"
ON public.players
FOR SELECT
TO anon, authenticated
USING (true);

-- Grant execute on the new functions
GRANT EXECUTE ON FUNCTION public.get_scoring_bracket_matches(uuid) TO anon, authenticated;

-- Grant execute on bracket match functions needed for scoring
GRANT EXECUTE ON FUNCTION public.calculate_match_team_scores(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_match_scores(UUID) TO anon, authenticated;
