CREATE OR REPLACE FUNCTION public.upsert_frame_result_atomic(
  p_match_frame_id UUID,
  p_event_player_id UUID,
  p_bracket_match_id INTEGER,
  p_putts_made INTEGER,
  p_points_earned INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.frame_results (
    match_frame_id,
    event_player_id,
    bracket_match_id,
    putts_made,
    points_earned,
    order_in_frame
  )
  SELECT
    p_match_frame_id,
    p_event_player_id,
    p_bracket_match_id,
    p_putts_made,
    p_points_earned,
    COALESCE(MAX(order_in_frame), 0) + 1
  FROM public.frame_results
  WHERE match_frame_id = p_match_frame_id
  ON CONFLICT (match_frame_id, event_player_id)
  DO UPDATE SET
    putts_made = EXCLUDED.putts_made,
    points_earned = EXCLUDED.points_earned,
    recorded_at = NOW();
END;
$$;
