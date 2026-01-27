CREATE OR REPLACE FUNCTION public.release_match_lane(
  p_event_id UUID,
  p_match_id INTEGER
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lane_id UUID;
BEGIN
  -- Get and lock the lane associated with this match
  SELECT lane_id INTO v_lane_id
  FROM public.bracket_match
  WHERE id = p_match_id AND event_id = p_event_id
  FOR UPDATE;

  IF v_lane_id IS NULL THEN
    -- No lane to release
    RETURN true;
  END IF;

  -- Clear lane from match
  UPDATE public.bracket_match
  SET lane_id = NULL
  WHERE id = p_match_id AND event_id = p_event_id;

  -- Set lane to idle (lock the lane row first)
  UPDATE public.lanes
  SET status = 'idle'
  WHERE id = v_lane_id AND event_id = p_event_id;

  RETURN true;
END;
$$;
