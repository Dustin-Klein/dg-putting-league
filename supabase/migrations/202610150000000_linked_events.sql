-- ============================================================================
-- Linked events (plan 07, Decision 2)
--
-- A second-chance tournament (and later side pots / makeup events) is its own
-- events row pointing at its parent, not a second bracket stage inside the parent:
-- it has its own team size, access code, lanes, entry fee, payout pool and status.
--
-- parent_event_id is ON DELETE RESTRICT, not CASCADE: a child event has its own
-- money and placements, so deleting the parent must not silently take them with it.
-- deleteEvent adds a readable error on top of this backstop.
--
-- Links are one level deep (a child may not itself be a parent). A CHECK can't see
-- the parent row, so that rule lives in the event service.
--
-- Like team_size, the new columns are not granted to clients: no client reads
-- events directly. app_server holds table-level privileges.
--
-- Rollback: supabase/rollbacks/202610150000000_linked_events.down.sql
-- ============================================================================

CREATE TYPE event_link_type AS ENUM ('second_chance', 'side', 'makeup');

ALTER TABLE public.events
  ADD COLUMN parent_event_id uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  ADD COLUMN link_type       event_link_type,
  ADD CONSTRAINT events_link_consistent
    CHECK ((parent_event_id IS NULL) = (link_type IS NULL)),
  ADD CONSTRAINT events_no_self_link CHECK (parent_event_id IS DISTINCT FROM id);

CREATE INDEX idx_events_parent ON public.events(parent_event_id) WHERE parent_event_id IS NOT NULL;
