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
  SELECT fr.id, fr.match_frame_id, fr.event_player_id, fr.putts_made, fr.points_earned
  FROM frame_results fr
  JOIN bracket_match bm ON fr.bracket_match_id = bm.id
  JOIN events e ON bm.event_id = e.id
  WHERE fr.bracket_match_id = p_bracket_match_id
    AND (
      e.status = 'bracket'
      OR public.is_league_admin_for_event(e.id)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_frame_results_for_match(integer) TO anon, authenticated;
