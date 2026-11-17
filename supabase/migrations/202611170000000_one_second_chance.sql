-- ============================================================================
-- At most one second-chance event per event
--
-- A second chance now runs alongside its parent's bracket and is filled from the
-- parent's knockouts, so a parent with two would split one pool of eliminated
-- players. createSecondChanceEvent checks first under the parent's event lock; this
-- index is the backstop.
--
-- Rollback: supabase/rollbacks/202611170000000_one_second_chance.down.sql
-- ============================================================================

DO $$
DECLARE
  duplicated text;
BEGIN
  SELECT string_agg(parent_event_id::text, ', ') INTO duplicated
  FROM (
    SELECT parent_event_id FROM putting_league.events
    WHERE link_type = 'second_chance'
    GROUP BY parent_event_id HAVING count(*) > 1
  ) d;
  IF duplicated IS NOT NULL THEN
    RAISE EXCEPTION 'Events with more than one second-chance event: %. Delete the extras before applying this migration.', duplicated;
  END IF;
END $$;

CREATE UNIQUE INDEX events_one_second_chance_per_parent
  ON putting_league.events (parent_event_id)
  WHERE link_type = 'second_chance';
