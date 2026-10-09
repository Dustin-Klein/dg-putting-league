-- Emergency rollback for 202610090000000_score_override.sql.

CREATE FUNCTION public.calculate_bracket_match_scores(p_bracket_match_id integer)
RETURNS TABLE (opponent1_score integer, opponent2_score integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant1_id integer;
  v_participant2_id integer;
  v_team1_id uuid;
  v_team2_id uuid;
  v_score1 integer := 0;
  v_score2 integer := 0;
BEGIN
  SELECT (opponent1->>'id')::integer, (opponent2->>'id')::integer
  INTO v_participant1_id, v_participant2_id
  FROM public.bracket_match WHERE id = p_bracket_match_id;

  SELECT team_id INTO v_team1_id FROM public.bracket_participant WHERE id = v_participant1_id;
  SELECT team_id INTO v_team2_id FROM public.bracket_participant WHERE id = v_participant2_id;

  IF v_team1_id IS NULL OR v_team2_id IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(fr.points_earned), 0) INTO v_score1
  FROM public.frame_results fr
  JOIN public.team_members tm ON tm.event_player_id = fr.event_player_id
  WHERE fr.bracket_match_id = p_bracket_match_id AND tm.team_id = v_team1_id;

  SELECT COALESCE(SUM(fr.points_earned), 0) INTO v_score2
  FROM public.frame_results fr
  JOIN public.team_members tm ON tm.event_player_id = fr.event_player_id
  WHERE fr.bracket_match_id = p_bracket_match_id AND tm.team_id = v_team2_id;

  RETURN QUERY SELECT v_score1, v_score2;
END;
$$;

CREATE FUNCTION public.sync_bracket_match_scores(p_bracket_match_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score1 integer;
  v_score2 integer;
BEGIN
  SELECT * INTO v_score1, v_score2
  FROM public.calculate_bracket_match_scores(p_bracket_match_id);

  UPDATE public.bracket_match
  SET opponent1 = jsonb_set(COALESCE(opponent1, '{}'::jsonb), '{score}', to_jsonb(v_score1)),
      opponent2 = jsonb_set(COALESCE(opponent2, '{}'::jsonb), '{score}', to_jsonb(v_score2)),
      updated_at = NOW()
  WHERE id = p_bracket_match_id;
END;
$$;

CREATE FUNCTION public.trigger_sync_bracket_match_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bracket_match_id integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_bracket_match_id := OLD.bracket_match_id;
  ELSE
    v_bracket_match_id := NEW.bracket_match_id;
  END IF;

  IF v_bracket_match_id IS NOT NULL THEN
    PERFORM public.sync_bracket_match_scores(v_bracket_match_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trigger_frame_results_sync_scores
AFTER INSERT OR UPDATE OR DELETE ON public.frame_results
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_bracket_match_scores();

ALTER TABLE public.bracket_match
  DROP CONSTRAINT bracket_match_score_override_pair_check,
  DROP COLUMN score_override_by,
  DROP COLUMN score_override_reason,
  DROP COLUMN score_override_2,
  DROP COLUMN score_override_1;
