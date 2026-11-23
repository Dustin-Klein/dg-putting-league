-- Emergency rollback for 202611240000000_putt_counts_reliable.sql.

BEGIN;
ALTER TABLE putting_league.events DROP COLUMN putt_counts_reliable;
COMMIT;
