CREATE OR REPLACE FUNCTION public.transition_event_to_bracket(
  p_event_id UUID,
  p_pool_assignments JSONB,
  p_teams JSONB,
  p_lane_count INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status event_status;
  v_pool_assignment JSONB;
  v_team JSONB;
  v_team_id UUID;
  v_member JSONB;
  v_lane_num INTEGER;
BEGIN
  -- 1. Verify current status and lock the event row
  SELECT status INTO v_current_status
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Event not found: %', p_event_id;
  END IF;

  IF v_current_status != 'pre-bracket' THEN
    RAISE EXCEPTION 'Event must be in pre-bracket status to transition. Current status: %', v_current_status;
  END IF;

  -- 2. Update event status to 'bracket'
  UPDATE public.events
  SET status = 'bracket'
  WHERE id = p_event_id;

  -- 3. Apply pool assignments to event_players
  FOR v_pool_assignment IN SELECT * FROM jsonb_array_elements(p_pool_assignments)
  LOOP
    UPDATE public.event_players
    SET pool = (v_pool_assignment->>'pool')::pool_type,
        pfa_score = (v_pool_assignment->>'pfa_score')::NUMERIC,
        scoring_method = v_pool_assignment->>'scoring_method'
    WHERE id = (v_pool_assignment->>'event_player_id')::UUID
      AND event_id = p_event_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Event player not found: %', v_pool_assignment->>'event_player_id';
    END IF;
  END LOOP;

  -- 4. Create teams and team members
  FOR v_team IN SELECT * FROM jsonb_array_elements(p_teams)
  LOOP
    -- Insert team
    INSERT INTO public.teams (event_id, seed, pool_combo)
    VALUES (p_event_id, (v_team->>'seed')::INTEGER, v_team->>'pool_combo')
    RETURNING id INTO v_team_id;

    -- Insert team members
    FOR v_member IN SELECT * FROM jsonb_array_elements(v_team->'members')
    LOOP
      INSERT INTO public.team_members (team_id, event_player_id, role)
      VALUES (
        v_team_id,
        (v_member->>'event_player_id')::UUID,
        v_member->>'role'
      );
    END LOOP;
  END LOOP;

  -- 5. Create lanes if lane_count > 0
  IF p_lane_count > 0 THEN
    -- Check if lanes already exist (idempotent)
    IF NOT EXISTS (SELECT 1 FROM public.lanes WHERE event_id = p_event_id) THEN
      FOR v_lane_num IN 1..p_lane_count
      LOOP
        INSERT INTO public.lanes (event_id, label, status)
        VALUES (p_event_id, 'Lane ' || v_lane_num, 'idle');
      END LOOP;
    END IF;
  END IF;
END;
$$;

