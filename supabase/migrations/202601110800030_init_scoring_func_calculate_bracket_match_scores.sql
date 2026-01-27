CREATE OR REPLACE FUNCTION public.calculate_bracket_match_scores(p_bracket_match_id INTEGER)
RETURNS TABLE (opponent1_score INTEGER, opponent2_score INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant1_id INTEGER;
  v_participant2_id INTEGER;
  v_team1_id UUID;
  v_team2_id UUID;
  v_score1 INTEGER := 0;
  v_score2 INTEGER := 0;
BEGIN
  -- Get participant IDs from bracket_match opponent JSONB
  SELECT
    (opponent1->>'id')::INTEGER,
    (opponent2->>'id')::INTEGER
  INTO v_participant1_id, v_participant2_id
  FROM public.bracket_match WHERE id = p_bracket_match_id;

  -- Get team IDs from participants (separate queries for query plan stability)
  SELECT team_id INTO v_team1_id FROM public.bracket_participant WHERE id = v_participant1_id;
  SELECT team_id INTO v_team2_id FROM public.bracket_participant WHERE id = v_participant2_id;

  IF v_team1_id IS NULL OR v_team2_id IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- Calculate team 1 score - uses denormalized bracket_match_id (skips match_frames JOIN)
  SELECT COALESCE(SUM(fr.points_earned), 0) INTO v_score1
  FROM public.frame_results fr
  JOIN public.team_members tm ON tm.event_player_id = fr.event_player_id
  WHERE fr.bracket_match_id = p_bracket_match_id
    AND tm.team_id = v_team1_id;

  -- Calculate team 2 score
  SELECT COALESCE(SUM(fr.points_earned), 0) INTO v_score2
  FROM public.frame_results fr
  JOIN public.team_members tm ON tm.event_player_id = fr.event_player_id
  WHERE fr.bracket_match_id = p_bracket_match_id
    AND tm.team_id = v_team2_id;

  RETURN QUERY SELECT v_score1, v_score2;
END;
$$;
