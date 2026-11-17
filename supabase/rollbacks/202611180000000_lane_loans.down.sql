-- Emergency rollback for 202611180000000_lane_loans.sql.
-- Loaned lanes go back to their owning event: take borrower matches off them and free
-- them first, or they would stay occupied by matches of an event that can't see them.

BEGIN;

UPDATE putting_league.bracket_match m
SET lane_id = NULL, lane_assigned_at = NULL
FROM putting_league.lane_loans l
WHERE m.lane_id = l.lane_id AND m.event_id = l.to_event_id;

UPDATE putting_league.lanes ln
SET status = CASE WHEN ln.status = 'maintenance' OR ln.maintenance_pending
                  THEN 'maintenance'::putting_league.lane_status
                  ELSE 'idle'::putting_league.lane_status END,
    maintenance_pending = false
FROM putting_league.lane_loans l
WHERE ln.id = l.lane_id;

DROP TABLE putting_league.lane_loans;

COMMIT;
