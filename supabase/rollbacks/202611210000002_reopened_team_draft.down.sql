-- Emergency rollback for 202611210000002_reopened_team_draft.sql.

BEGIN;
ALTER TABLE putting_league.events DROP COLUMN reopened_team_draft;
COMMIT;
