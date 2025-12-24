-- Migration to enable public access code validation for scoring
-- This allows unauthenticated users to validate an access code and score matches

-- Security definer function to validate access code without RLS restrictions
CREATE OR REPLACE FUNCTION public.validate_event_access_code(p_access_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_record record;
BEGIN
  SELECT
    id,
    event_date,
    location,
    lane_count,
    bonus_point_enabled,
    status
  INTO event_record
  FROM public.events
  WHERE access_code = p_access_code;

  IF event_record IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'id', event_record.id,
    'event_date', event_record.event_date,
    'location', event_record.location,
    'lane_count', event_record.lane_count,
    'bonus_point_enabled', event_record.bonus_point_enabled,
    'status', event_record.status
  );
END;
$$;

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
-- These allow anon users to read data needed for scoring when they have a valid access code

-- Policy for bracket_match: allow anon to read matches for events in bracket status
CREATE POLICY "Enable public read for bracket scoring"
ON public.bracket_match
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_match.event_id
    AND e.status = 'bracket'
  )
);

-- Policy for match table: allow anon to read/write matches for events in bracket status
CREATE POLICY "Enable public read for match scoring"
ON public.match
FOR SELECT
TO anon
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
TO anon
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
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = match.event_id
    AND e.status = 'bracket'
  )
);

-- Policy for match_frames: allow anon to read/write frames for bracket matches
CREATE POLICY "Enable public read for frame scoring"
ON public.match_frames
FOR SELECT
TO anon
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
TO anon
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.match m
    JOIN public.events e ON e.id = m.event_id
    WHERE m.id = match_frames.match_id
    AND e.status = 'bracket'
  )
);

-- Policy for frame_results: allow anon to read/write results for bracket matches
CREATE POLICY "Enable public read for result scoring"
ON public.frame_results
FOR SELECT
TO anon
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
TO anon
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
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.match m ON m.id = mf.match_id
    JOIN public.events e ON e.id = m.event_id
    WHERE mf.id = frame_results.match_frame_id
    AND e.status = 'bracket'
  )
);

-- Policy for teams: allow anon to read teams for events in bracket status
CREATE POLICY "Enable public read for teams in bracket"
ON public.teams
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = teams.event_id
    AND e.status = 'bracket'
  )
);

-- Policy for team_members: allow anon to read team members for events in bracket status
CREATE POLICY "Enable public read for team members in bracket"
ON public.team_members
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.id = team_members.team_id
    AND e.status = 'bracket'
  )
);

-- Policy for event_players: allow anon to read event players for events in bracket status
CREATE POLICY "Enable public read for event players in bracket"
ON public.event_players
FOR SELECT
TO anon
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
GRANT EXECUTE ON FUNCTION public.validate_event_access_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scoring_bracket_matches(uuid) TO anon, authenticated;
