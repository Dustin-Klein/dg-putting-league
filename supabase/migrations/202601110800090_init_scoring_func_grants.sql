GRANT EXECUTE ON FUNCTION public.sync_bracket_match_scores(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_bracket_match_scores(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_frame_result_atomic(UUID, UUID, INTEGER, INTEGER, INTEGER) TO anon, authenticated;
