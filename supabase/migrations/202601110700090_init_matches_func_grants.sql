GRANT EXECUTE ON FUNCTION public.set_lane_idle(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_lane_maintenance(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_match_lane(UUID, UUID, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_lane_to_match(UUID, UUID, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_bracket_match_score(INTEGER, INTEGER, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scoring_bracket_matches(uuid) TO anon, authenticated;
