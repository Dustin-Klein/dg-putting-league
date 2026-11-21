-- Emergency rollback for 202611210000001_bracket_late_entries_and_holds.sql.
-- Filled byes stay filled; their matches go back to ordinary numbering.

BEGIN;
ALTER TABLE putting_league.bracket_match
  DROP COLUMN late_entry_at,
  DROP COLUMN held_at;
COMMIT;
