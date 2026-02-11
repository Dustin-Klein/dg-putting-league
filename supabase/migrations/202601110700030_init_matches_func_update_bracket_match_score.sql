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
  v_existing_opp1 JSONB;
  v_existing_opp2 JSONB;
  v_final_opp1 JSONB;
  v_final_opp2 JSONB;
  v_final_status INTEGER;
BEGIN
  -- Lock the row and read existing opponents
  SELECT event_id, opponent1, opponent2
  INTO v_event_id, v_existing_opp1, v_existing_opp2
  FROM public.bracket_match
  WHERE id = p_match_id
  FOR UPDATE;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  SELECT status INTO v_event_status
  FROM public.events
  WHERE id = v_event_id;

  IF v_event_status != 'bracket' THEN
    RAISE EXCEPTION 'Event is not in bracket play';
  END IF;

  -- Merge opponent1
  IF p_opponent1 IS NOT NULL THEN
    v_final_opp1 := COALESCE(v_existing_opp1, '{}'::jsonb) || p_opponent1;
    -- Preserve existing id only if caller did not explicitly send an id key
    IF (v_existing_opp1->>'id') IS NOT NULL AND (v_final_opp1->>'id') IS NULL
       AND NOT (p_opponent1 ? 'id') THEN
      v_final_opp1 := jsonb_set(v_final_opp1, '{id}', v_existing_opp1->'id');
    END IF;
  ELSE
    v_final_opp1 := v_existing_opp1;
  END IF;

  -- Merge opponent2
  IF p_opponent2 IS NOT NULL THEN
    v_final_opp2 := COALESCE(v_existing_opp2, '{}'::jsonb) || p_opponent2;
    -- Preserve existing id only if caller did not explicitly send an id key
    IF (v_existing_opp2->>'id') IS NOT NULL AND (v_final_opp2->>'id') IS NULL
       AND NOT (p_opponent2 ? 'id') THEN
      v_final_opp2 := jsonb_set(v_final_opp2, '{id}', v_existing_opp2->'id');
    END IF;
  ELSE
    v_final_opp2 := v_existing_opp2;
  END IF;

  -- Auto-promote status to Ready if both opponents now have ids
  v_final_status := p_status;
  IF v_final_status IS NOT NULL
     AND v_final_status < 2
     AND v_final_opp1 IS NOT NULL AND (v_final_opp1->>'id') IS NOT NULL
     AND v_final_opp2 IS NOT NULL AND (v_final_opp2->>'id') IS NOT NULL
  THEN
    v_final_status := 2; -- Ready
  END IF;

  UPDATE public.bracket_match
  SET status = v_final_status,
      opponent1 = v_final_opp1,
      opponent2 = v_final_opp2,
      updated_at = NOW()
  WHERE id = p_match_id;

  RETURN true;
END;
$$;
