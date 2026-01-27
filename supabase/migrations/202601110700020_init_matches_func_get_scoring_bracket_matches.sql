CREATE OR REPLACE FUNCTION public.get_scoring_bracket_matches(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
