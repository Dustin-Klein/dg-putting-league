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
  v_assignment jsonb;
  v_count integer := 0;
BEGIN
  FOR v_assignment IN SELECT * FROM jsonb_array_elements(p_assignments)
  LOOP
    -- Use existing assign_lane_to_match logic for each pair
    IF assign_lane_to_match(
      p_event_id,
      (v_assignment->>'lane_id')::uuid,
      (v_assignment->>'match_id')::integer
    ) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
