CREATE OR REPLACE FUNCTION public.get_pfa_scores_bulk(
  p_event_player_ids UUID[],
  p_since_date TIMESTAMPTZ
)
RETURNS TABLE (event_player_id UUID, total_points NUMERIC, frame_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fr.event_player_id,
    SUM(fr.points_earned)::NUMERIC AS total_points,
    COUNT(*)::BIGINT AS frame_count
  FROM public.frame_results fr
  WHERE fr.event_player_id = ANY(p_event_player_ids)
    AND fr.recorded_at >= p_since_date
  GROUP BY fr.event_player_id;
$$;
