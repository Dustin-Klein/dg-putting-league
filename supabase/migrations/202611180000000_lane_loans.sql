-- ============================================================================
-- Lane loans: a second chance plays on lanes borrowed from its main event
--
-- Both events run at the same venue at the same time, on one set of physical
-- lanes. A loan moves a lane's use, not its ownership: lanes.event_id stays the
-- main event (labels, history and the main event's lane numbering never change)
-- while the borrowing event's lane queries also see its loaned lanes and the
-- lender's no longer do. A lane is on at most one loan. A lane lent while the
-- lender's match is on it stays the lender's until that match leaves it.
--
-- Deleting either event ends the loan (the lane row stays with its owner, or goes
-- with it). The service resets the lane to idle first, so a lane is never left
-- occupied by a match that no longer exists.
--
-- No client reads this table (the server reads as app_server): RLS with no
-- policies and no client grants.
--
-- Rollback: supabase/rollbacks/202611180000000_lane_loans.down.sql
-- ============================================================================

CREATE TABLE putting_league.lane_loans (
  lane_id       uuid PRIMARY KEY REFERENCES putting_league.lanes(id) ON DELETE CASCADE,
  from_event_id uuid NOT NULL REFERENCES putting_league.events(id) ON DELETE CASCADE,
  to_event_id   uuid NOT NULL REFERENCES putting_league.events(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lane_loans_to_another_event CHECK (from_event_id <> to_event_id)
);

CREATE INDEX idx_lane_loans_to_event ON putting_league.lane_loans(to_event_id);
CREATE INDEX idx_lane_loans_from_event ON putting_league.lane_loans(from_event_id);

ALTER TABLE putting_league.lane_loans ENABLE ROW LEVEL SECURITY;

-- Default privileges already give app_server DML and clients nothing; stated
-- explicitly so the grants don't depend on who ran the migration.
REVOKE ALL ON putting_league.lane_loans FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON putting_league.lane_loans TO app_server;
