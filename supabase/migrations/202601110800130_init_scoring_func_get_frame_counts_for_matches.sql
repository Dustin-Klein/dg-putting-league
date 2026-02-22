CREATE OR REPLACE FUNCTION public.get_frame_counts_for_matches(p_match_ids integer[])
RETURNS TABLE (bracket_match_id integer, frame_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mf.bracket_match_id, COUNT(*)::BIGINT AS frame_count
  FROM public.match_frames mf
  WHERE mf.bracket_match_id = ANY(p_match_ids)
  GROUP BY mf.bracket_match_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_frame_counts_for_matches(integer[]) TO anon, authenticated;
