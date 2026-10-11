-- Emergency rollback for 202610150000000_linked_events.sql.
-- Drops every parent/child link: linked events become unrelated events in the same league.

DROP INDEX public.idx_events_parent;
ALTER TABLE public.events
  DROP CONSTRAINT events_no_self_link,
  DROP CONSTRAINT events_link_consistent,
  DROP COLUMN link_type,
  DROP COLUMN parent_event_id;
DROP TYPE event_link_type;
