-- Frame zone stamp tests. Run with: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = putting_league, public, extensions;

SELECT no_plan();

SELECT col_not_null('putting_league', 'frame_results', 'putt_distance_ft', 'frame_results.putt_distance_ft is NOT NULL');
SELECT col_not_null('putting_league', 'qualification_frames', 'putt_distance_ft', 'qualification_frames.putt_distance_ft is NOT NULL');

-- The period link is server-only; the distance is public, as on event_players.
SELECT ok(
  NOT has_column_privilege(r, 'putting_league.' || t, 'zone_period_id', 'SELECT'),
  format('%s cannot read %s.zone_period_id', r, t)
)
FROM unnest(ARRAY['anon', 'authenticated']) AS r, unnest(ARRAY['frame_results', 'qualification_frames']) AS t;

SELECT ok(
  has_column_privilege(r, 'putting_league.' || t, c, 'SELECT'),
  format('%s can read %s.%s', r, t, c)
)
FROM unnest(ARRAY['anon', 'authenticated']) AS r,
  (VALUES
    ('frame_results', 'id'), ('frame_results', 'match_frame_id'), ('frame_results', 'event_player_id'),
    ('frame_results', 'bracket_match_id'), ('frame_results', 'putts_made'), ('frame_results', 'points_earned'),
    ('frame_results', 'order_in_frame'), ('frame_results', 'recorded_at'), ('frame_results', 'putt_distance_ft'),
    ('qualification_frames', 'id'), ('qualification_frames', 'qualification_round_id'),
    ('qualification_frames', 'event_id'), ('qualification_frames', 'event_player_id'),
    ('qualification_frames', 'frame_number'), ('qualification_frames', 'putts_made'),
    ('qualification_frames', 'points_earned'), ('qualification_frames', 'recorded_by'),
    ('qualification_frames', 'recorded_at'), ('qualification_frames', 'putt_distance_ft')
  ) AS cols(t, c);

SELECT * FROM finish();
ROLLBACK;
