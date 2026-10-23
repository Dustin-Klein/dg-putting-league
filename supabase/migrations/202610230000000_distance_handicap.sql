-- ============================================================================
-- Distance-based handicaps (plan 06)
--
-- A player's handicap is a zone (1..N, nominally 21 / 27 / 33 ft), kept per league.
-- The zone is the unit a player's record is kept against; the distance is how far
-- that zone measured at a given event. A zone changes only when an event the player
-- played in is completed (automatic promotion, or demotion if the league opts in) or
-- when a league admin changes it. Below-threshold periods produce a demotion
-- suggestion for an admin to apply or dismiss instead of a move.
--
--   league_handicap_settings   thresholds, minimums, rolling window, toggles
--   league_handicap_zones      the league's nominal ladder (default for new events)
--   event_zone_distances       what each zone measured at one event
--   player_zone_periods        current zone (open period) + history
--   player_zone_evaluations    every evaluation, the demotion review queue, skips
--   event_players.*            snapshot of zone / distance / period per entry
--
-- Stats are derived from frame_results / qualification_frames on read; there are
-- no counters to drift. All writers of periods, settings and zones serialize on one
-- league-scoped advisory lock (lockLeagueHandicap), taken after any event lock.
--
-- No client reads these tables directly (the server reads as app_server), so they
-- get RLS with no policies and no client grants. Of the new event_players columns
-- only zone and putt_distance_ft are public (they are shown on every scoring screen).
--
-- Deploy: event_players.putt_distance_ft is NOT NULL with no default, so app builds
-- from before this change can't add players once it is applied. Apply it together
-- with the app deploy that writes the column, when no event is taking entries.
--
-- Rollback: supabase/rollbacks/202610230000000_distance_handicap.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. League settings and the nominal zone ladder
-- ----------------------------------------------------------------------------
CREATE TABLE putting_league.league_handicap_settings (
  league_id                 uuid PRIMARY KEY REFERENCES putting_league.leagues(id) ON DELETE CASCADE,
  enabled                   boolean      NOT NULL DEFAULT false,
  default_zone              smallint     NOT NULL DEFAULT 2,
  demote_below_pct          numeric(5,2) NOT NULL DEFAULT 50.00 CHECK (demote_below_pct BETWEEN 0 AND 100),
  promote_above_pct         numeric(5,2) NOT NULL DEFAULT 75.00 CHECK (promote_above_pct BETWEEN 0 AND 100),
  -- 0 = criterion disabled (not "always satisfied"); at least one must be live.
  min_putts                 integer      NOT NULL DEFAULT 50 CHECK (min_putts >= 0),
  min_matches               integer      NOT NULL DEFAULT 3  CHECK (min_matches >= 0),
  -- Q12: a period's sample is its most recent window_putts putts (whole events,
  -- newest first). NULL = the whole period.
  window_putts              integer      DEFAULT 150 CHECK (window_putts IS NULL OR window_putts > 0),
  count_qualification_putts boolean      NOT NULL DEFAULT true,
  -- Q11: demotions are suggested to an admin, not applied, unless the league opts in.
  auto_demote_enabled       boolean      NOT NULL DEFAULT false,
  updated_at                timestamptz  NOT NULL DEFAULT now(),
  updated_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT league_handicap_settings_band_check CHECK (demote_below_pct < promote_above_pct),
  CONSTRAINT league_handicap_settings_minimum_check CHECK (min_putts > 0 OR min_matches > 0)
);

-- Rows, not columns, so a league can have more than three zones without a migration.
-- Contiguity (1..N), strictly increasing distances and the minimum step are
-- validated in the settings service.
CREATE TABLE putting_league.league_handicap_zones (
  league_id   uuid         NOT NULL REFERENCES putting_league.leagues(id) ON DELETE CASCADE,
  zone        smallint     NOT NULL CHECK (zone BETWEEN 1 AND 9),
  distance_ft numeric(5,2) NOT NULL CHECK (distance_ft > 0),
  PRIMARY KEY (league_id, zone)
);

-- ----------------------------------------------------------------------------
-- 2. Events: the handicap flag (snapshotted from the league) and tonight's distances
-- ----------------------------------------------------------------------------
ALTER TABLE putting_league.events ADD COLUMN handicap_enabled boolean NOT NULL DEFAULT false;

-- Seeded from the league ladder at event creation; editable until the event's
-- first frame is recorded, frozen afterwards.
CREATE TABLE putting_league.event_zone_distances (
  event_id    uuid         NOT NULL REFERENCES putting_league.events(id) ON DELETE CASCADE,
  zone        smallint     NOT NULL CHECK (zone BETWEEN 1 AND 9),
  distance_ft numeric(5,2) NOT NULL CHECK (distance_ft > 0),
  PRIMARY KEY (event_id, zone)
);

-- ----------------------------------------------------------------------------
-- 3. Zone periods: the open period is the current zone, closed ones the history
-- ----------------------------------------------------------------------------
-- 'correction' is reserved for data repair (a period opened in error); no normal
-- flow writes it.
CREATE TYPE putting_league.zone_change_reason AS ENUM
  ('initial', 'auto_promote', 'auto_demote', 'manual', 'admin_demote', 'correction');

CREATE TABLE putting_league.player_zone_periods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  league_id           uuid NOT NULL REFERENCES putting_league.leagues(id) ON DELETE CASCADE,
  zone                smallint NOT NULL CHECK (zone BETWEEN 1 AND 9),
  -- Nominal distance when the period opened; display only.
  distance_ft         numeric(5,2) NOT NULL CHECK (distance_ft > 0),
  started_at          timestamptz NOT NULL DEFAULT now(),
  start_reason        putting_league.zone_change_reason NOT NULL,
  -- The event whose evaluation opened it (automatic moves).
  started_by_event_id uuid REFERENCES putting_league.events(id) ON DELETE SET NULL,
  -- The admin who opened it (manual changes, applied suggestions). Admin-only.
  started_by_user     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ended_at            timestamptz,
  -- {putts_made, putts_attempted, make_pct, matches, events, evaluated_event_id}
  end_stats           jsonb,
  -- Admin-only: routinely explains why (an injury, a year off).
  note                text
);

CREATE UNIQUE INDEX one_open_zone_period
  ON putting_league.player_zone_periods (player_id, league_id) WHERE ended_at IS NULL;
-- Single-column indexes: volumes are tiny (a handful of periods per player), and
-- drizzle-kit introspects multi-column operator classes non-deterministically,
-- which would make `npm run db:check` flaky.
CREATE INDEX idx_zone_periods_player
  ON putting_league.player_zone_periods (player_id);
CREATE INDEX idx_zone_periods_league_open
  ON putting_league.player_zone_periods (league_id) WHERE ended_at IS NULL;

-- ----------------------------------------------------------------------------
-- 4. Evaluations: audit trail, idempotency key and the demotion review queue
-- ----------------------------------------------------------------------------
CREATE TYPE putting_league.zone_decision AS ENUM ('stay', 'promote', 'demote');
CREATE TYPE putting_league.zone_suggestion_resolution AS ENUM ('applied', 'dismissed', 'superseded');

CREATE TABLE putting_league.player_zone_evaluations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES putting_league.events(id) ON DELETE CASCADE,
  player_id       uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  league_id       uuid NOT NULL REFERENCES putting_league.leagues(id) ON DELETE CASCADE,
  zone_period_id  uuid NOT NULL REFERENCES putting_league.player_zone_periods(id) ON DELETE CASCADE,
  zone            smallint NOT NULL,                             -- zone that was evaluated
  stats           jsonb    NOT NULL,                             -- PeriodStats at evaluation time
  decision        putting_league.zone_decision NOT NULL,
  eligible        boolean  NOT NULL,
  applied         boolean  NOT NULL,                             -- did it change the zone?
  resolution      putting_league.zone_suggestion_resolution,     -- null = open (for a demote)
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text,
  -- Set when the player was not evaluated for this event.
  skip_reason     text CHECK (skip_reason IN ('period_changed', 'excluded')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_zone_evaluations_event_player_key UNIQUE (event_id, player_id),
  CONSTRAINT player_zone_evaluations_skip_check
    CHECK (skip_reason IS NULL OR (NOT eligible AND NOT applied AND decision = 'stay'))
);

-- The admin review queue: open demotion suggestions.
CREATE INDEX idx_zone_evals_open_demote
  ON putting_league.player_zone_evaluations (league_id)
  WHERE decision = 'demote' AND applied = false AND resolution IS NULL;
CREATE INDEX idx_zone_evals_player
  ON putting_league.player_zone_evaluations (player_id);

-- ----------------------------------------------------------------------------
-- 5. Snapshot on each event entry
-- ----------------------------------------------------------------------------
ALTER TABLE putting_league.event_players
  ADD COLUMN zone                  smallint,
  ADD COLUMN putt_distance_ft      numeric(5,2),
  ADD COLUMN zone_period_id        uuid REFERENCES putting_league.player_zone_periods(id) ON DELETE SET NULL,
  -- The organizer's explicit decision that this entry is not representative
  -- (e.g. an injury accommodation). Editable after scoring; admin-only.
  ADD COLUMN exclude_from_handicap boolean NOT NULL DEFAULT false,
  ADD COLUMN handicap_note         text,
  -- An admin set this entry's distance by hand (before its first frame); snapshot
  -- refreshes keep it unless the entry's zone changes.
  ADD COLUMN distance_override     boolean NOT NULL DEFAULT false;

-- Everyone putted from the event distance before handicaps existed.
UPDATE putting_league.event_players ep
SET putt_distance_ft = e.putt_distance_ft
FROM putting_league.events e
WHERE e.id = ep.event_id AND ep.putt_distance_ft IS NULL;

ALTER TABLE putting_league.event_players
  ALTER COLUMN putt_distance_ft SET NOT NULL,
  ADD CONSTRAINT event_players_putt_distance_ft_check CHECK (putt_distance_ft > 0);

CREATE INDEX idx_event_players_zone_period
  ON putting_league.event_players (zone_period_id) WHERE zone_period_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. Privileges and RLS
-- ----------------------------------------------------------------------------
ALTER TABLE putting_league.league_handicap_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE putting_league.league_handicap_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE putting_league.event_zone_distances ENABLE ROW LEVEL SECURITY;
ALTER TABLE putting_league.player_zone_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE putting_league.player_zone_evaluations ENABLE ROW LEVEL SECURITY;

-- Default privileges already give app_server DML and clients nothing; stated
-- explicitly so the grants don't depend on who ran the migration.
REVOKE ALL ON
  putting_league.league_handicap_settings,
  putting_league.league_handicap_zones,
  putting_league.event_zone_distances,
  putting_league.player_zone_periods,
  putting_league.player_zone_evaluations
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  putting_league.league_handicap_settings,
  putting_league.league_handicap_zones,
  putting_league.event_zone_distances,
  putting_league.player_zone_periods,
  putting_league.player_zone_evaluations
TO app_server;

-- The zone badge on scoring screens is public; the period link, exclusion flag,
-- note and override flag are not.
GRANT SELECT (zone, putt_distance_ft) ON putting_league.event_players TO anon, authenticated;
