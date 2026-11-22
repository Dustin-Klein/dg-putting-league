-- ============================================================================
-- Per-frame zone stamp: a player can change zone in the middle of an event
--
-- Each frame_results / qualification_frames row records the zone period and the
-- distance its entry had when the frame was first scored. Handicap stats (zone
-- periods, career by distance) aggregate by these columns, so frames before a
-- mid-event zone move count for the old zone and distance and frames after it for
-- the new one. A re-score of an existing frame keeps its stamp.
--
-- Existing rows are backfilled from their entry, which held one zone for the whole
-- event, so every existing stat is unchanged.
--
-- Clients keep reading both tables as before plus putt_distance_ft (the distance is
-- already public on event_players); the period link stays server-only, as it is on
-- event_players. Table-level SELECT becomes column-level SELECT to keep it hidden.
--
-- Deploy: putt_distance_ft is NOT NULL with no default, so app builds from before
-- this change can't record frames once it is applied. Apply it together with the
-- app deploy that writes the columns, when no event is being scored.
--
-- Rollback: supabase/rollbacks/202611230000000_frame_zone_stamp.down.sql
-- ============================================================================

ALTER TABLE putting_league.frame_results
  ADD COLUMN zone_period_id uuid REFERENCES putting_league.player_zone_periods(id) ON DELETE SET NULL,
  ADD COLUMN putt_distance_ft numeric(5,2);

ALTER TABLE putting_league.qualification_frames
  ADD COLUMN zone_period_id uuid REFERENCES putting_league.player_zone_periods(id) ON DELETE SET NULL,
  ADD COLUMN putt_distance_ft numeric(5,2);

UPDATE putting_league.frame_results fr
SET zone_period_id = ep.zone_period_id, putt_distance_ft = ep.putt_distance_ft
FROM putting_league.event_players ep
WHERE ep.id = fr.event_player_id;

UPDATE putting_league.qualification_frames qf
SET zone_period_id = ep.zone_period_id, putt_distance_ft = ep.putt_distance_ft
FROM putting_league.event_players ep
WHERE ep.id = qf.event_player_id;

ALTER TABLE putting_league.frame_results
  ALTER COLUMN putt_distance_ft SET NOT NULL,
  ADD CONSTRAINT frame_results_putt_distance_ft_check CHECK (putt_distance_ft > 0);

ALTER TABLE putting_league.qualification_frames
  ALTER COLUMN putt_distance_ft SET NOT NULL,
  ADD CONSTRAINT qualification_frames_putt_distance_ft_check CHECK (putt_distance_ft > 0);

CREATE INDEX idx_frame_results_zone_period ON putting_league.frame_results(zone_period_id)
  WHERE zone_period_id IS NOT NULL;
CREATE INDEX idx_qualification_frames_zone_period ON putting_league.qualification_frames(zone_period_id)
  WHERE zone_period_id IS NOT NULL;

REVOKE SELECT ON putting_league.frame_results, putting_league.qualification_frames FROM anon, authenticated;

GRANT SELECT (id, match_frame_id, event_player_id, bracket_match_id, putts_made, points_earned,
              order_in_frame, recorded_at, putt_distance_ft)
  ON putting_league.frame_results TO anon, authenticated;

GRANT SELECT (id, qualification_round_id, event_id, event_player_id, frame_number, putts_made,
              points_earned, recorded_by, recorded_at, putt_distance_ft)
  ON putting_league.qualification_frames TO anon, authenticated;
