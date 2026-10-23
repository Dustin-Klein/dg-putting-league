-- Emergency rollback for 202610230000000_distance_handicap.sql.
-- Drops every zone, period, evaluation and per-event distance. Entries keep no record
-- of the distance they putted from; events go back to one distance for everyone.

DROP INDEX putting_league.idx_event_players_zone_period;
ALTER TABLE putting_league.event_players
  DROP CONSTRAINT event_players_putt_distance_ft_check,
  DROP COLUMN distance_override,
  DROP COLUMN handicap_note,
  DROP COLUMN exclude_from_handicap,
  DROP COLUMN zone_period_id,
  DROP COLUMN putt_distance_ft,
  DROP COLUMN zone;

DROP TABLE putting_league.player_zone_evaluations;
DROP TYPE putting_league.zone_suggestion_resolution;
DROP TYPE putting_league.zone_decision;
DROP TABLE putting_league.player_zone_periods;
DROP TYPE putting_league.zone_change_reason;
DROP TABLE putting_league.event_zone_distances;
ALTER TABLE putting_league.events DROP COLUMN handicap_enabled;
DROP TABLE putting_league.league_handicap_zones;
DROP TABLE putting_league.league_handicap_settings;
