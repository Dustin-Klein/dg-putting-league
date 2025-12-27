-- Link bracket_match to existing match table for detailed scoring
-- The bracket_match handles bracket progression, while match handles detailed frame-by-frame scoring

-- Add bracket_match_id to existing match table
ALTER TABLE public.match ADD COLUMN bracket_match_id INTEGER REFERENCES public.bracket_match(id) ON DELETE CASCADE;

-- Create index for looking up match by bracket_match_id
CREATE INDEX idx_match_bracket_match ON public.match(bracket_match_id);

-- Add team score columns to match table for caching calculated scores
ALTER TABLE public.match ADD COLUMN team_one_score INTEGER DEFAULT 0;
ALTER TABLE public.match ADD COLUMN team_two_score INTEGER DEFAULT 0;

-- Function to calculate team scores from frame_results
CREATE OR REPLACE FUNCTION public.calculate_match_team_scores(p_match_id UUID)
RETURNS TABLE (team_one_score INTEGER, team_two_score INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_one_id UUID;
  v_team_two_id UUID;
  v_team_one_score INTEGER := 0;
  v_team_two_score INTEGER := 0;
BEGIN
  -- Get team IDs for this match
  SELECT team_one_id, team_two_id INTO v_team_one_id, v_team_two_id
  FROM public.match WHERE id = p_match_id;

  IF v_team_one_id IS NULL OR v_team_two_id IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- Calculate team one score (sum of both players' points)
  SELECT COALESCE(SUM(fr.points_earned), 0) INTO v_team_one_score
  FROM public.frame_results fr
  JOIN public.match_frames mf ON mf.id = fr.match_frame_id
  JOIN public.team_members tm ON tm.event_player_id = fr.event_player_id
  WHERE mf.match_id = p_match_id
    AND tm.team_id = v_team_one_id;

  -- Calculate team two score
  SELECT COALESCE(SUM(fr.points_earned), 0) INTO v_team_two_score
  FROM public.frame_results fr
  JOIN public.match_frames mf ON mf.id = fr.match_frame_id
  JOIN public.team_members tm ON tm.event_player_id = fr.event_player_id
  WHERE mf.match_id = p_match_id
    AND tm.team_id = v_team_two_id;

  RETURN QUERY SELECT v_team_one_score, v_team_two_score;
END;
$$;

-- Function to update match scores and sync to bracket_match
CREATE OR REPLACE FUNCTION public.sync_match_scores(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_one_score INTEGER;
  v_team_two_score INTEGER;
  v_bracket_match_id INTEGER;
  v_team_one_id UUID;
  v_team_two_id UUID;
  v_winner_team_id UUID;
BEGIN
  -- Calculate scores
  SELECT * INTO v_team_one_score, v_team_two_score
  FROM public.calculate_match_team_scores(p_match_id);

  -- Get match details
  SELECT bracket_match_id, team_one_id, team_two_id
  INTO v_bracket_match_id, v_team_one_id, v_team_two_id
  FROM public.match WHERE id = p_match_id;

  -- Determine winner if scores are different
  IF v_team_one_score > v_team_two_score THEN
    v_winner_team_id := v_team_one_id;
  ELSIF v_team_two_score > v_team_one_score THEN
    v_winner_team_id := v_team_two_id;
  ELSE
    v_winner_team_id := NULL; -- Tie
  END IF;

  -- Update match table with scores
  UPDATE public.match
  SET team_one_score = v_team_one_score,
      team_two_score = v_team_two_score,
      winner_team_id = v_winner_team_id
  WHERE id = p_match_id;

  -- Update bracket_match if linked
  IF v_bracket_match_id IS NOT NULL THEN
    UPDATE public.bracket_match
    SET opponent1 = jsonb_set(
          COALESCE(opponent1, '{}'::jsonb),
          '{score}',
          to_jsonb(v_team_one_score)
        ),
        opponent2 = jsonb_set(
          COALESCE(opponent2, '{}'::jsonb),
          '{score}',
          to_jsonb(v_team_two_score)
        ),
        updated_at = NOW()
    WHERE id = v_bracket_match_id;
  END IF;
END;
$$;

-- Trigger to sync scores when frame_results change
CREATE OR REPLACE FUNCTION public.trigger_sync_match_scores()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_match_id UUID;
BEGIN
  -- Get match_id from match_frame
  IF TG_OP = 'DELETE' THEN
    SELECT match_id INTO v_match_id
    FROM public.match_frames WHERE id = OLD.match_frame_id;
  ELSE
    SELECT match_id INTO v_match_id
    FROM public.match_frames WHERE id = NEW.match_frame_id;
  END IF;

  -- Sync scores
  IF v_match_id IS NOT NULL THEN
    PERFORM public.sync_match_scores(v_match_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trigger_frame_results_sync_scores
AFTER INSERT OR UPDATE OR DELETE ON public.frame_results
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_match_scores();

-- RLS policies for match_frames (if not already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'match_frames' AND policyname = 'Enable read access for league admins'
  ) THEN
    CREATE POLICY "Enable read access for league admins"
    ON public.match_frames FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.match m
        WHERE m.id = match_frames.match_id
        AND public.is_league_admin_for_event(m.event_id)
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'match_frames' AND policyname = 'Enable insert for league admins'
  ) THEN
    CREATE POLICY "Enable insert for league admins"
    ON public.match_frames FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.match m
        WHERE m.id = match_frames.match_id
        AND public.is_league_admin_for_event(m.event_id)
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'match_frames' AND policyname = 'Enable update for league admins'
  ) THEN
    CREATE POLICY "Enable update for league admins"
    ON public.match_frames FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.match m
        WHERE m.id = match_frames.match_id
        AND public.is_league_admin_for_event(m.event_id)
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'match_frames' AND policyname = 'Enable delete for league admins'
  ) THEN
    CREATE POLICY "Enable delete for league admins"
    ON public.match_frames FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.match m
        WHERE m.id = match_frames.match_id
        AND public.is_league_admin_for_event(m.event_id)
      )
    );
  END IF;
END $$;

-- RLS policies for frame_results
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'frame_results' AND policyname = 'Enable read access for league admins'
  ) THEN
    CREATE POLICY "Enable read access for league admins"
    ON public.frame_results FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.match_frames mf
        JOIN public.match m ON m.id = mf.match_id
        WHERE mf.id = frame_results.match_frame_id
        AND public.is_league_admin_for_event(m.event_id)
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'frame_results' AND policyname = 'Enable insert for league admins'
  ) THEN
    CREATE POLICY "Enable insert for league admins"
    ON public.frame_results FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.match_frames mf
        JOIN public.match m ON m.id = mf.match_id
        WHERE mf.id = frame_results.match_frame_id
        AND public.is_league_admin_for_event(m.event_id)
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'frame_results' AND policyname = 'Enable update for league admins'
  ) THEN
    CREATE POLICY "Enable update for league admins"
    ON public.frame_results FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.match_frames mf
        JOIN public.match m ON m.id = mf.match_id
        WHERE mf.id = frame_results.match_frame_id
        AND public.is_league_admin_for_event(m.event_id)
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'frame_results' AND policyname = 'Enable delete for league admins'
  ) THEN
    CREATE POLICY "Enable delete for league admins"
    ON public.frame_results FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.match_frames mf
        JOIN public.match m ON m.id = mf.match_id
        WHERE mf.id = frame_results.match_frame_id
        AND public.is_league_admin_for_event(m.event_id)
      )
    );
  END IF;
END $$;

-- Enable RLS on these tables
ALTER TABLE public.match_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frame_results ENABLE ROW LEVEL SECURITY;

-- Enable realtime for match and frame_results
ALTER PUBLICATION supabase_realtime ADD TABLE public.match;
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_frames;
ALTER PUBLICATION supabase_realtime ADD TABLE public.frame_results;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.calculate_match_team_scores TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_match_scores TO authenticated;
