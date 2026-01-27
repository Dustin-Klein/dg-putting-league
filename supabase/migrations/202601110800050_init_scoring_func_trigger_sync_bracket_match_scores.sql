CREATE OR REPLACE FUNCTION public.trigger_sync_bracket_match_scores()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bracket_match_id INTEGER;
BEGIN
  -- Use denormalized bracket_match_id directly (avoids lookup during cascade deletes)
  IF TG_OP = 'DELETE' THEN
    v_bracket_match_id := OLD.bracket_match_id;
  ELSE
    v_bracket_match_id := NEW.bracket_match_id;
  END IF;

  -- Sync scores if linked to bracket_match
  IF v_bracket_match_id IS NOT NULL THEN
    PERFORM public.sync_bracket_match_scores(v_bracket_match_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
