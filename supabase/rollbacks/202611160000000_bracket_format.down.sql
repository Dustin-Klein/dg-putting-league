-- Emergency rollback for 202611160000000_bracket_format.sql.
-- Single-elimination events keep their generated brackets but read back as double elimination.

ALTER TABLE putting_league.events
  DROP CONSTRAINT events_third_place_needs_single_elim,
  DROP CONSTRAINT events_grand_final_needs_double_elim,
  DROP COLUMN third_place_match,
  DROP COLUMN bracket_format;
DROP TYPE putting_league.bracket_format;
