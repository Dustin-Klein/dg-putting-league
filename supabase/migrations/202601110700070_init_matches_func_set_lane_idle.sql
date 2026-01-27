CREATE OR REPLACE FUNCTION public.set_lane_idle(
  p_event_id UUID,
  p_lane_id UUID
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Lock the lane row first to prevent race with assign_lane_to_match
  PERFORM id FROM public.lanes
  WHERE id = p_lane_id AND event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lane not found';
  END IF;

  UPDATE public.lanes
  SET status = 'idle'
  WHERE id = p_lane_id AND event_id = p_event_id;

  -- Clear lane from any matches just in case
  UPDATE public.bracket_match
  SET lane_id = NULL
  WHERE lane_id = p_lane_id AND event_id = p_event_id;

  RETURN true;
END;
$$;
