CREATE OR REPLACE FUNCTION public.rollback_bracket_transition(p_event_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status event_status;
BEGIN
  -- Lock and verify event is in bracket status
  SELECT status INTO v_current_status
  FROM public.events WHERE id = p_event_id FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Event not found: %', p_event_id;
  END IF;

  IF v_current_status != 'bracket' THEN
    RETURN; -- Already rolled back or never transitioned
  END IF;

  -- Delete bracket data (CASCADE handles matches, rounds, groups, participants)
  DELETE FROM public.bracket_stage WHERE tournament_id = p_event_id;

  -- Delete teams (CASCADE handles team_members)
  DELETE FROM public.teams WHERE event_id = p_event_id;

  -- Delete lanes
  DELETE FROM public.lanes WHERE event_id = p_event_id;

  -- Reset pool assignments
  UPDATE public.event_players
  SET pool = NULL, pfa_score = NULL, scoring_method = NULL
  WHERE event_id = p_event_id;

  -- Revert status
  UPDATE public.events SET status = 'pre-bracket' WHERE id = p_event_id;
END;
$$;
