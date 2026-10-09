-- Emergency rollback for 202610100000000_lane_maintenance_pending.sql.

ALTER TABLE public.lanes
  DROP COLUMN maintenance_pending;
