-- ============================================================================
-- 09_init_qualification.sql
-- Qualification Rounds and Frames
-- ============================================================================

CREATE TABLE public.qualification_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  frame_count INTEGER NOT NULL DEFAULT 5,
  created_by UUID REFERENCES auth.users(id),
  status qualification_status NOT NULL DEFAULT 'not_started',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_qualification_rounds_event ON public.qualification_rounds(event_id);

CREATE TABLE public.qualification_frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_round_id UUID NOT NULL REFERENCES public.qualification_rounds(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_player_id UUID NOT NULL REFERENCES public.event_players(id) ON DELETE CASCADE,
  frame_number INTEGER NOT NULL CHECK (frame_number > 0),
  putts_made INTEGER NOT NULL CHECK (putts_made BETWEEN 0 AND 3),
  points_earned INTEGER NOT NULL CHECK (points_earned BETWEEN 0 AND 4),
  recorded_by UUID REFERENCES auth.users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_player_id, frame_number)
);

CREATE INDEX idx_qualification_frames_event ON public.qualification_frames(event_id);
CREATE INDEX idx_qualification_frames_round ON public.qualification_frames(qualification_round_id);
CREATE INDEX IF NOT EXISTS idx_qualification_frames_event_player ON public.qualification_frames(event_player_id);

ALTER TABLE public.qualification_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_frames ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for admins or pre-bracket"
ON public.qualification_rounds
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = qualification_rounds.event_id
    AND e.status = 'pre-bracket'
    AND e.qualification_round_enabled = true
  )
  OR public.is_league_admin_for_event(qualification_rounds.event_id)
);

CREATE POLICY "Enable insert for admins"
ON public.qualification_rounds
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_league_admin_for_event(qualification_rounds.event_id)
);

CREATE POLICY "Enable insert for pre-bracket scoring"
ON public.qualification_rounds
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = qualification_rounds.event_id
    AND e.status = 'pre-bracket'
    AND e.qualification_round_enabled = true
  )
);

CREATE POLICY "Enable update for admins or pre-bracket scoring"
ON public.qualification_rounds
FOR UPDATE
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = qualification_rounds.event_id
    AND e.status = 'pre-bracket'
    AND e.qualification_round_enabled = true
  )
  OR public.is_league_admin_for_event(qualification_rounds.event_id)
);

CREATE POLICY "Enable delete for league admins"
ON public.qualification_rounds
FOR DELETE
USING (
  public.is_league_admin_for_event(qualification_rounds.event_id)
);

CREATE POLICY "Enable read for admins or pre-bracket"
ON public.qualification_frames
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = qualification_frames.event_id
    AND e.status = 'pre-bracket'
    AND e.qualification_round_enabled = true
  )
  OR public.is_league_admin_for_event(qualification_frames.event_id)
);

CREATE POLICY "Enable insert for admins"
ON public.qualification_frames
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_league_admin_for_event(qualification_frames.event_id)
);

CREATE POLICY "Enable insert for pre-bracket scoring"
ON public.qualification_frames
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = qualification_frames.event_id
    AND e.status = 'pre-bracket'
    AND e.qualification_round_enabled = true
  )
);

CREATE POLICY "Enable update for admins or pre-bracket scoring"
ON public.qualification_frames
FOR UPDATE
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = qualification_frames.event_id
    AND e.status = 'pre-bracket'
    AND e.qualification_round_enabled = true
  )
  OR public.is_league_admin_for_event(qualification_frames.event_id)
);

CREATE POLICY "Enable delete for league admins"
ON public.qualification_frames
FOR DELETE
USING (
  public.is_league_admin_for_event(qualification_frames.event_id)
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.qualification_frames;
