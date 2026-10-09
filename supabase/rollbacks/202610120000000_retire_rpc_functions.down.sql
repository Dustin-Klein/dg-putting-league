-- Emergency rollback for 202610120000000_retire_rpc_functions.sql.
-- Recreates the dropped functions exactly as they were (pg_get_functiondef) and
-- restores app_server's EXECUTE privilege. Client privileges stay revoked (plan 01).
-- Only needed together with a rollback of the application to before plan 04.

CREATE OR REPLACE FUNCTION public.assign_lane_to_match(p_event_id uuid, p_lane_id uuid, p_match_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Assign lane to match only if it hasn't been assigned a lane yet
  UPDATE public.bracket_match
  SET lane_id = p_lane_id, lane_assigned_at = NOW()
  WHERE id = p_match_id AND event_id = p_event_id AND lane_id IS NULL;

  IF NOT FOUND THEN
    -- Match was already assigned or not found; revert lane to idle
    UPDATE public.lanes
    SET status = 'idle'
    WHERE id = p_lane_id;
    RETURN false;
  END IF;

  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.bulk_assign_lanes_to_matches(p_event_id uuid, p_assignments jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND m.lane_id IS NULL
    RETURNING m.id, m.lane_id AS assigned_lane_id
  ),
  -- Revert lanes that were marked occupied but whose match was already assigned
  reverted_lanes AS (
    UPDATE public.lanes l
    SET status = 'idle'
    FROM updated_lanes ul
    WHERE l.id = ul.id
      AND ul.match_id NOT IN (SELECT id FROM updated_matches)
    RETURNING l.id
  )
  SELECT count(*) INTO v_count FROM updated_matches;

  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.bulk_upsert_frame_results(p_results jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.frame_results (
    match_frame_id,
    event_player_id,
    bracket_match_id,
    putts_made,
    points_earned,
    order_in_frame
  )
  SELECT
    (r->>'match_frame_id')::UUID,
    (r->>'event_player_id')::UUID,
    (r->>'bracket_match_id')::INTEGER,
    (r->>'putts_made')::INTEGER,
    (r->>'points_earned')::INTEGER,
    COALESCE(
      (SELECT MAX(fr.order_in_frame) FROM public.frame_results fr WHERE fr.match_frame_id = (r->>'match_frame_id')::UUID),
      0
    ) + ROW_NUMBER() OVER (PARTITION BY r->>'match_frame_id' ORDER BY ordinality)
  FROM jsonb_array_elements(p_results) WITH ORDINALITY AS t(r, ordinality)
  ON CONFLICT (match_frame_id, event_player_id)
  DO UPDATE SET
    putts_made = EXCLUDED.putts_made,
    points_earned = EXCLUDED.points_earned,
    recorded_at = NOW();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_frame_counts_for_matches(p_match_ids integer[])
 RETURNS TABLE(bracket_match_id integer, frame_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT mf.bracket_match_id, COUNT(*)::BIGINT AS frame_count
  FROM public.match_frames mf
  WHERE mf.bracket_match_id = ANY(p_match_ids)
  GROUP BY mf.bracket_match_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_frame_results_for_match(p_bracket_match_id integer)
 RETURNS TABLE(id uuid, match_frame_id uuid, event_player_id uuid, putts_made integer, points_earned integer)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  SELECT fr.id, fr.match_frame_id, fr.event_player_id, fr.putts_made, fr.points_earned
  FROM frame_results fr
  JOIN bracket_match bm ON fr.bracket_match_id = bm.id
  JOIN events e ON bm.event_id = e.id
  WHERE fr.bracket_match_id = p_bracket_match_id
    AND (
      e.status = 'bracket'
      OR public.is_league_admin_for_event(e.id)
    );
$function$
;

CREATE OR REPLACE FUNCTION public.get_league_active_event_counts(league_ids uuid[], status_filter text)
 RETURNS TABLE(league_id uuid, count bigint)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  SELECT e.league_id, count(*)
  FROM public.events e
  WHERE e.league_id = ANY(league_ids)
    AND (e.status IS NULL OR e.status::text != status_filter)
  GROUP BY e.league_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_league_event_counts(league_ids uuid[])
 RETURNS TABLE(league_id uuid, count bigint)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  SELECT league_id, count(*)
  FROM public.events
  WHERE league_id = ANY(league_ids)
  GROUP BY league_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_pfa_scores_bulk(p_event_player_ids uuid[], p_since_date timestamp with time zone)
 RETURNS TABLE(event_player_id uuid, total_points numeric, frame_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    fr.event_player_id,
    SUM(fr.points_earned)::NUMERIC AS total_points,
    COUNT(*)::BIGINT AS frame_count
  FROM public.frame_results fr
  WHERE fr.event_player_id = ANY(p_event_player_ids)
    AND fr.recorded_at >= p_since_date
  GROUP BY fr.event_player_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_scoring_bracket_matches(p_event_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT json_agg(
      json_build_object(
        'id', bm.id,
        'status', bm.status,
        'round_id', bm.round_id,
        'number', bm.number
      )
    )
    FROM public.bracket_match bm
    WHERE bm.event_id = p_event_id
    AND bm.status IN (2, 3) -- Ready = 2, Running = 3
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_email_by_id(league_id_param uuid, user_id_param uuid)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT u.email
  FROM auth.users u
  WHERE u.id = user_id_param
    AND EXISTS (
      SELECT 1 FROM public.league_admins la
      WHERE la.league_id = league_id_param
        AND la.user_id = user_id_param
    )
    AND EXISTS (
      SELECT 1 FROM public.league_admins la
      WHERE la.league_id = league_id_param
        AND la.user_id = auth.uid()
    )
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(league_id_param uuid, email_param text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT u.id
  FROM auth.users u
  WHERE u.email = lower(trim(email_param))
    AND EXISTS (
      SELECT 1 FROM public.league_admins la
      WHERE la.league_id = league_id_param
        AND la.user_id = auth.uid()
        AND la.role = 'owner'
    )
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.is_any_league_admin(user_id_param uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE user_id = user_id_param
    AND role IN ('owner', 'admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_league_admin_for_bracket_match(bracket_match_id_param integer)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.bracket_match bm
    JOIN public.events e ON e.id = bm.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE bm.id = bracket_match_id_param
      AND la.user_id = auth.uid()
      AND la.role IN ('owner', 'admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_league_admin_for_match_frame(match_frame_id_param uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.match_frames mf
    JOIN public.bracket_match bm ON bm.id = mf.bracket_match_id
    JOIN public.events e ON e.id = bm.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE mf.id = match_frame_id_param
      AND la.user_id = auth.uid()
      AND la.role IN ('owner', 'admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_league_owner(league_id_param uuid, user_id_param uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_id = league_id_param
    AND user_id = user_id_param
    AND role = 'owner'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.league_has_no_admins(league_id_param uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_id = league_id_param
  );
$function$
;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_window_ms integer, p_increment boolean DEFAULT true)
 RETURNS TABLE(count integer, reset_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Opportunistic cleanup of long-expired windows
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits rl WHERE rl.reset_at < now() - interval '1 hour';
  END IF;

  IF NOT p_increment THEN
    RETURN QUERY
      SELECT rl.count, rl.reset_at
      FROM public.rate_limits rl
      WHERE rl.key = p_key AND rl.reset_at > now();
    RETURN;
  END IF;

  RETURN QUERY
    INSERT INTO public.rate_limits AS rl (key, count, reset_at)
    VALUES (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rl.reset_at <= now() THEN 1 ELSE rl.count + 1 END,
      reset_at = CASE WHEN rl.reset_at <= now() THEN EXCLUDED.reset_at ELSE rl.reset_at END
    RETURNING rl.count, rl.reset_at;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.release_match_lane(p_event_id uuid, p_lane_id uuid DEFAULT NULL::uuid, p_match_id integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Validate that the match is on the expected lane (when provided)
  IF p_lane_id IS NOT NULL AND v_lane_id != p_lane_id THEN
    RETURN false;
  END IF;

  -- Clear lane from match
  UPDATE public.bracket_match
  SET lane_id = NULL, lane_assigned_at = NULL
  WHERE id = p_match_id AND event_id = p_event_id;

  -- Set lane to idle (lock the lane row first)
  UPDATE public.lanes
  SET status = 'idle'
  WHERE id = v_lane_id AND event_id = p_event_id;

  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rollback_bracket_transition(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_lane_idle(p_event_id uuid, p_lane_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_lane_maintenance(p_event_id uuid, p_lane_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.transition_event_to_bracket(p_event_id uuid, p_pool_assignments jsonb, p_teams jsonb, p_lane_count integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.update_bracket_match_score(p_match_id integer, p_status integer, p_opponent1 jsonb, p_opponent2 jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    IF (p_opponent1 ? 'id') AND (p_opponent1->>'id') IS NULL THEN
      v_final_opp1 := '{"id": null}'::jsonb;
    ELSIF (p_opponent1 ? 'id')
      AND ((v_existing_opp1->>'id') IS DISTINCT FROM (p_opponent1->>'id')) THEN
      v_final_opp1 := p_opponent1;
    ELSE
      v_final_opp1 := COALESCE(v_existing_opp1, '{}'::jsonb) || p_opponent1;
    END IF;
  ELSE
    v_final_opp1 := v_existing_opp1;
  END IF;

  -- Merge opponent2
  IF p_opponent2 IS NOT NULL THEN
    IF (p_opponent2 ? 'id') AND (p_opponent2->>'id') IS NULL THEN
      v_final_opp2 := '{"id": null}'::jsonb;
    ELSIF (p_opponent2 ? 'id')
      AND ((v_existing_opp2->>'id') IS DISTINCT FROM (p_opponent2->>'id')) THEN
      v_final_opp2 := p_opponent2;
    ELSE
      v_final_opp2 := COALESCE(v_existing_opp2, '{}'::jsonb) || p_opponent2;
    END IF;
  ELSE
    v_final_opp2 := v_existing_opp2;
  END IF;

  -- Enforce position from existing opponent data (structural field, never caller-modifiable)
  IF v_existing_opp1 IS NOT NULL AND (v_existing_opp1 ? 'position') THEN
    v_final_opp1 := COALESCE(v_final_opp1, '{}'::jsonb) || jsonb_build_object('position', v_existing_opp1->'position');
  ELSIF v_final_opp1 IS NOT NULL AND (v_final_opp1 ? 'position') THEN
    v_final_opp1 := v_final_opp1 - 'position';
  END IF;

  IF v_existing_opp2 IS NOT NULL AND (v_existing_opp2 ? 'position') THEN
    v_final_opp2 := COALESCE(v_final_opp2, '{}'::jsonb) || jsonb_build_object('position', v_existing_opp2->'position');
  ELSIF v_final_opp2 IS NOT NULL AND (v_final_opp2 ? 'position') THEN
    v_final_opp2 := v_final_opp2 - 'position';
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
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_frame_result_atomic(p_match_frame_id uuid, p_event_player_id uuid, p_bracket_match_id integer, p_putts_made integer, p_points_earned integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.frame_results (
    match_frame_id,
    event_player_id,
    bracket_match_id,
    putts_made,
    points_earned,
    order_in_frame
  )
  SELECT
    p_match_frame_id,
    p_event_player_id,
    p_bracket_match_id,
    p_putts_made,
    p_points_earned,
    COALESCE(MAX(order_in_frame), 0) + 1
  FROM public.frame_results
  WHERE match_frame_id = p_match_frame_id
  ON CONFLICT (match_frame_id, event_player_id)
  DO UPDATE SET
    putts_made = EXCLUDED.putts_made,
    points_earned = EXCLUDED.points_earned,
    recorded_at = NOW();
END;
$function$
;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_league_admin(uuid, uuid), public.is_league_admin_for_event(uuid), public.is_tournament_admin(uuid) TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_server;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_server;
