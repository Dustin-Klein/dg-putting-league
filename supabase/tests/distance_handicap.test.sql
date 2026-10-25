-- Distance handicap schema tests (plan 06). Run with: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = putting_league, public, extensions;

SELECT no_plan();

-- ---------------------------------------------------------------------------
-- Privileges: clients read nothing from the handicap tables; only zone and
-- distance on event_players are public. app_server has DML only.
-- ---------------------------------------------------------------------------

SELECT table_privs_are('putting_league', t, r, ARRAY[]::text[])
FROM unnest(ARRAY['league_handicap_settings', 'league_handicap_zones', 'event_zone_distances',
                  'player_zone_periods', 'player_zone_evaluations']) AS t,
     unnest(ARRAY['anon', 'authenticated']) AS r;

SELECT table_privs_are('putting_league', t, 'app_server', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
FROM unnest(ARRAY['league_handicap_settings', 'league_handicap_zones', 'event_zone_distances',
                  'player_zone_periods', 'player_zone_evaluations']) AS t;

SELECT column_privs_are('putting_league', 'event_players', c, r, ARRAY['SELECT'])
FROM unnest(ARRAY['zone', 'putt_distance_ft']) AS c, unnest(ARRAY['anon', 'authenticated']) AS r;

SELECT column_privs_are('putting_league', 'event_players', c, r, ARRAY[]::text[])
FROM unnest(ARRAY['zone_period_id', 'exclude_from_handicap', 'handicap_note', 'distance_override']) AS c,
     unnest(ARRAY['anon', 'authenticated']) AS r;

SELECT ok(
  (SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE relnamespace = 'putting_league'::regnamespace
     AND relname IN ('league_handicap_settings', 'league_handicap_zones', 'event_zone_distances',
                     'player_zone_periods', 'player_zone_evaluations')),
  'every handicap table has RLS enabled'
);

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

INSERT INTO putting_league.leagues (id, name) VALUES ('00000000-0000-0000-0000-00000009a001', 'Handicap League');
INSERT INTO public.players (id, full_name) VALUES ('00000000-0000-0000-0000-00000009b001', 'Handicap Player');

SELECT throws_ok(
  $$ INSERT INTO putting_league.league_handicap_settings (league_id, min_putts, min_matches)
     VALUES ('00000000-0000-0000-0000-00000009a001', 0, 0) $$,
  '23514', NULL, 'at least one eligibility minimum must be live'
);
SELECT throws_ok(
  $$ INSERT INTO putting_league.league_handicap_settings (league_id, demote_below_pct, promote_above_pct)
     VALUES ('00000000-0000-0000-0000-00000009a001', 75, 75) $$,
  '23514', NULL, 'the demotion threshold must be below the promotion threshold'
);
SELECT lives_ok(
  $$ INSERT INTO putting_league.league_handicap_settings (league_id, min_putts, min_matches)
     VALUES ('00000000-0000-0000-0000-00000009a001', 60, 0) $$,
  'one minimum may be disabled'
);

INSERT INTO putting_league.player_zone_periods (id, player_id, league_id, zone, distance_ft, start_reason)
VALUES ('00000000-0000-0000-0000-00000009c001', '00000000-0000-0000-0000-00000009b001',
        '00000000-0000-0000-0000-00000009a001', 2, 27, 'initial');
SELECT throws_ok(
  $$ INSERT INTO putting_league.player_zone_periods (player_id, league_id, zone, distance_ft, start_reason)
     VALUES ('00000000-0000-0000-0000-00000009b001', '00000000-0000-0000-0000-00000009a001', 3, 33, 'manual') $$,
  '23505', NULL, 'a player has at most one open period per league'
);

INSERT INTO putting_league.events (id, league_id, event_date, lane_count, putt_distance_ft, access_code, status, handicap_enabled)
VALUES ('00000000-0000-0000-0000-00000009d001', '00000000-0000-0000-0000-00000009a001',
        '2026-10-01', 2, 15, 'handicap01', 'completed', true);
SELECT throws_ok(
  $$ INSERT INTO putting_league.player_zone_evaluations
       (event_id, player_id, league_id, zone_period_id, zone, stats, decision, eligible, applied, skip_reason)
     VALUES ('00000000-0000-0000-0000-00000009d001', '00000000-0000-0000-0000-00000009b001',
             '00000000-0000-0000-0000-00000009a001', '00000000-0000-0000-0000-00000009c001',
             2, '{}', 'promote', false, false, 'excluded') $$,
  '23514', NULL, 'a skipped evaluation decides nothing'
);
SELECT throws_ok(
  $$ INSERT INTO putting_league.event_players (event_id, player_id)
     VALUES ('00000000-0000-0000-0000-00000009d001', '00000000-0000-0000-0000-00000009b001') $$,
  '23502', NULL, 'every entry records the distance it putts from'
);

SELECT * FROM finish();
ROLLBACK;
