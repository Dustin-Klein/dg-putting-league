ALTER TABLE public.bracket_match
  ADD COLUMN score_override_1 integer NULL,
  ADD COLUMN score_override_2 integer NULL,
  ADD COLUMN score_override_reason text NULL,
  ADD COLUMN score_override_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT bracket_match_score_override_pair_check CHECK (
    (score_override_1 IS NULL AND score_override_2 IS NULL)
    OR
    (score_override_1 IS NOT NULL AND score_override_2 IS NOT NULL
      AND score_override_1 >= 0 AND score_override_2 >= 0)
  );

-- Production verification before this migration found that all 99 matches with
-- frames had stored scores equal to their frame sums, and no manual-only matches.
-- Overrides therefore intentionally start NULL; no data backfill is needed.

DROP TRIGGER trigger_frame_results_sync_scores ON public.frame_results;
DROP FUNCTION public.trigger_sync_bracket_match_scores();
DROP FUNCTION public.sync_bracket_match_scores(integer);
DROP FUNCTION public.calculate_bracket_match_scores(integer);
