CREATE OR REPLACE FUNCTION public.bulk_upsert_frame_results(
  p_results JSONB
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
    (r->>'match_frame_id')::UUID,
    (r->>'event_player_id')::UUID,
    (r->>'bracket_match_id')::INTEGER,
    (r->>'putts_made')::INTEGER,
    (r->>'points_earned')::INTEGER,
    COALESCE(
      (SELECT MAX(fr.order_in_frame) FROM public.frame_results fr WHERE fr.match_frame_id = (r->>'match_frame_id')::UUID),
      0
    ) + ROW_NUMBER() OVER (PARTITION BY r->>'match_frame_id' ORDER BY ordinality)
  FROM jsonb_array_elements(p_results) WITH ORDINALITY AS t(r, ordinality)
  ON CONFLICT (match_frame_id, event_player_id)
  DO UPDATE SET
    putts_made = EXCLUDED.putts_made,
    points_earned = EXCLUDED.points_earned,
    recorded_at = NOW();
END;
$$;
