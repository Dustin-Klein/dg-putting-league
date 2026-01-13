CREATE OR REPLACE FUNCTION public.assign_lane_to_match(
  p_event_id UUID,
  p_lane_id UUID,
  p_match_id INTEGER
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lane_status lane_status;
  v_event_status event_status;
BEGIN
  -- Verify the event is in bracket status
  SELECT status INTO v_event_status
  FROM public.events
  WHERE id = p_event_id;

  IF v_event_status IS NULL OR v_event_status != 'bracket' THEN
    RAISE EXCEPTION 'Event is not in bracket play';
  END IF;

  -- Lock the lane row and check status
  SELECT status INTO v_lane_status
  FROM public.lanes
  WHERE id = p_lane_id AND event_id = p_event_id
  FOR UPDATE;

  IF v_lane_status IS NULL THEN
    RAISE EXCEPTION 'Lane not found';
  END IF;

  IF v_lane_status != 'idle' THEN
    -- Lane is not available
    RETURN false;
  END IF;

  -- Update lane status to occupied
  UPDATE public.lanes
  SET status = 'occupied'
  WHERE id = p_lane_id;

  -- Assign lane to match (keep current status)
  UPDATE public.bracket_match
  SET lane_id = p_lane_id
  WHERE id = p_match_id AND event_id = p_event_id;

  RETURN true;
END;
$$;
