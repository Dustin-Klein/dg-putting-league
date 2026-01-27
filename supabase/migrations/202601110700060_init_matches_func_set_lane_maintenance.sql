CREATE OR REPLACE FUNCTION public.set_lane_maintenance(
  p_event_id UUID,
  p_lane_id UUID
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Lock and update lane status
  UPDATE public.lanes
  SET status = 'maintenance'
  WHERE id = p_lane_id AND event_id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lane not found';
  END IF;

  -- Clear lane from any matches
  UPDATE public.bracket_match
  SET lane_id = NULL
  WHERE lane_id = p_lane_id AND event_id = p_event_id;

  RETURN true;
END;
$$;
