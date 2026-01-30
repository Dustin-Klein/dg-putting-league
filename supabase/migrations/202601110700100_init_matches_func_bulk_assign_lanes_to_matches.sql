CREATE OR REPLACE FUNCTION public.bulk_assign_lanes_to_matches(
  p_event_id UUID,
  p_assignments JSONB  -- Array of {lane_id, match_id}
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_status event_status;
  v_count integer := 0;
BEGIN
  -- Verify the event is in bracket status
  SELECT status INTO v_event_status
  FROM public.events
  WHERE id = p_event_id;

  IF v_event_status IS NULL OR v_event_status != 'bracket' THEN
    RAISE EXCEPTION 'Event is not in bracket play';
  END IF;

  WITH assignments AS (
    SELECT
      (value->>'lane_id')::uuid AS lane_id,
      (value->>'match_id')::integer AS match_id
    FROM jsonb_array_elements(p_assignments)
  ),
  updated_lanes AS (
    UPDATE public.lanes l
    SET status = 'occupied'
    FROM assignments a
    WHERE l.id = a.lane_id
      AND l.event_id = p_event_id
      AND l.status = 'idle'
    RETURNING l.id, a.match_id
  ),
  updated_matches AS (
    UPDATE public.bracket_match m
    SET lane_id = ul.id, lane_assigned_at = NOW()
    FROM updated_lanes ul
    WHERE m.id = ul.match_id
      AND m.event_id = p_event_id
    RETURNING m.id
  )
  SELECT count(*) INTO v_count FROM updated_matches;

  RETURN v_count;
END;
$$;
