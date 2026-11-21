-- Emergency rollback for 202611210000000_team_member_substitutions.sql.
-- Team members already swapped stay swapped; only the history is dropped.

BEGIN;
DROP TABLE putting_league.team_member_substitutions;
COMMIT;
