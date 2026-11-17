-- ============================================================================
-- Bracket format: single or double elimination per event
--
-- double_grand_final only means something for double elimination, and the optional
-- third-place (consolation) match only for single elimination; the CHECKs keep the
-- inapplicable flag false so readers never have to reinterpret it.
--
-- Like team_size, the new columns are not granted to clients: no client reads
-- events directly. app_server holds table-level privileges.
--
-- Rollback: supabase/rollbacks/202611160000000_bracket_format.down.sql
-- ============================================================================

CREATE TYPE putting_league.bracket_format AS ENUM ('double_elimination', 'single_elimination');

ALTER TABLE putting_league.events
  ADD COLUMN bracket_format putting_league.bracket_format NOT NULL DEFAULT 'double_elimination',
  ADD COLUMN third_place_match boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT events_grand_final_needs_double_elim
    CHECK (bracket_format = 'double_elimination' OR double_grand_final = false),
  ADD CONSTRAINT events_third_place_needs_single_elim
    CHECK (bracket_format = 'single_elimination' OR third_place_match = false);
