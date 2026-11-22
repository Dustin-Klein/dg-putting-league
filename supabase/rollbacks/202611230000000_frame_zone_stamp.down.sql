-- Emergency rollback for 202611230000000_frame_zone_stamp.sql.
-- Mid-event zone moves lose their split: stats fall back to one zone per entry.

BEGIN;
DROP INDEX putting_league.idx_frame_results_zone_period;
DROP INDEX putting_league.idx_qualification_frames_zone_period;

ALTER TABLE putting_league.frame_results
  DROP COLUMN zone_period_id,
  DROP COLUMN putt_distance_ft;

ALTER TABLE putting_league.qualification_frames
  DROP COLUMN zone_period_id,
  DROP COLUMN putt_distance_ft;

REVOKE SELECT ON putting_league.frame_results, putting_league.qualification_frames FROM anon, authenticated;
GRANT SELECT ON putting_league.frame_results, putting_league.qualification_frames TO anon, authenticated;
COMMIT;
