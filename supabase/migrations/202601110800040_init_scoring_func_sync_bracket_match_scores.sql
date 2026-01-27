CREATE OR REPLACE FUNCTION public.sync_bracket_match_scores(p_bracket_match_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score1 INTEGER;
  v_score2 INTEGER;
BEGIN
  -- Calculate scores
  SELECT * INTO v_score1, v_score2
  FROM public.calculate_bracket_match_scores(p_bracket_match_id);

  -- Update bracket_match with scores
  UPDATE public.bracket_match
  SET opponent1 = jsonb_set(
        COALESCE(opponent1, '{}'::jsonb),
        '{score}',
        to_jsonb(v_score1)
      ),
      opponent2 = jsonb_set(
        COALESCE(opponent2, '{}'::jsonb),
        '{score}',
        to_jsonb(v_score2)
      ),
      updated_at = NOW()
  WHERE id = p_bracket_match_id;
END;
$$;
