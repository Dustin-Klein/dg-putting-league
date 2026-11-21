-- ============================================================================
-- Filling a Round 1 bye after the bracket exists
--
-- late_entry_at: set on bracket matches that were hidden byes and became real when
-- a late team took the bye. Match numbers (M1, M2, ...) skip these and give them
-- the numbers after every other match, in fill order, so numbers that were already
-- announced or are on a lane never change.
--
-- held_at: the organizer is holding the match (usually the next match of a team
-- whose bye might still be filled). Lane auto-assignment skips held matches.
--
-- Both are app-owned columns brackets-manager never reads or writes. bracket_match
-- is already in the realtime publication and readable under its existing policies.
--
-- Rollback: supabase/rollbacks/202611210000001_bracket_late_entries_and_holds.down.sql
-- ============================================================================

ALTER TABLE putting_league.bracket_match
  ADD COLUMN late_entry_at timestamptz,
  ADD COLUMN held_at timestamptz;
