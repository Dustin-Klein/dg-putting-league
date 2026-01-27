CREATE OR REPLACE FUNCTION public.get_league_event_counts(league_ids uuid[])
RETURNS TABLE (league_id uuid, count bigint)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT league_id, count(*)
  FROM public.events
  WHERE league_id = ANY(league_ids)
  GROUP BY league_id;
$$;
