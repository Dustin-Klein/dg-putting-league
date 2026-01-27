CREATE OR REPLACE FUNCTION public.get_league_active_event_counts(league_ids uuid[], status_filter text)
RETURNS TABLE (league_id uuid, count bigint)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT e.league_id, count(*)
  FROM public.events e
  WHERE e.league_id = ANY(league_ids)
    AND (e.status IS NULL OR e.status::text != status_filter)
  GROUP BY e.league_id;
$$;
