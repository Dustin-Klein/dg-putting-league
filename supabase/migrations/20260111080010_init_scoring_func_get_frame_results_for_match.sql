CREATE OR REPLACE FUNCTION public.get_frame_results_for_match(p_bracket_match_id integer)
RETURNS TABLE (
  id uuid,
  match_frame_id uuid,
  event_player_id uuid,
  putts_made integer,
  points_earned integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, match_frame_id, event_player_id, putts_made, points_earned
  FROM frame_results
  WHERE bracket_match_id = p_bracket_match_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_frame_results_for_match(integer) TO anon, authenticated;
