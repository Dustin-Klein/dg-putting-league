CREATE OR REPLACE FUNCTION public.update_bracket_match_score(
  p_match_id INTEGER,
  p_status INTEGER,
  p_opponent1 JSONB,
  p_opponent2 JSONB
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_event_status event_status;
BEGIN
  -- Get the event_id and verify the match exists
  SELECT event_id INTO v_event_id
  FROM public.bracket_match
  WHERE id = p_match_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  -- Verify the event is in bracket status
  SELECT status INTO v_event_status
  FROM public.events
  WHERE id = v_event_id;

  IF v_event_status != 'bracket' THEN
    RAISE EXCEPTION 'Event is not in bracket play';
  END IF;

  -- Update the match
  UPDATE public.bracket_match
  SET status = p_status,
      opponent1 = p_opponent1,
      opponent2 = p_opponent2,
      updated_at = NOW()
  WHERE id = p_match_id;

  RETURN true;
END;
$$;
