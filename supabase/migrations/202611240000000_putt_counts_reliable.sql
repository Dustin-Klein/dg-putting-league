-- ============================================================================
-- Putt-count provenance: whether an event's stored putts_made are real
--
-- Last season's imported events (Dec – early Feb) were entered as points only; their
-- putts_made values were derived from points and aren't real putt counts. Event stats
-- show "—" for make %, the putts mix and 3-for-3 on these events, and season baselines
-- for make % skip them (points baselines keep them).
--
-- Backfill rule, run once: an event with the bonus point on that has a frame where
-- 3 putts scored 3 points. App scoring always awards 4 for 3-for-3 with the bonus on,
-- and bonus_point_enabled can't change after an event is created, so only imported
-- events match. Any future import sets the column explicitly.
--
-- Server-only: no grant to anon/authenticated (events has column-level SELECT grants).
--
-- Rollback: supabase/rollbacks/202611240000000_putt_counts_reliable.down.sql
-- ============================================================================

ALTER TABLE putting_league.events
  ADD COLUMN putt_counts_reliable boolean NOT NULL DEFAULT true;

UPDATE putting_league.events e
SET putt_counts_reliable = false
WHERE e.bonus_point_enabled
  AND (
    EXISTS (
      SELECT 1
      FROM putting_league.frame_results fr
      JOIN putting_league.event_players ep ON ep.id = fr.event_player_id
      WHERE ep.event_id = e.id AND fr.putts_made = 3 AND fr.points_earned = 3
    )
    OR EXISTS (
      SELECT 1
      FROM putting_league.qualification_frames qf
      WHERE qf.event_id = e.id AND qf.putts_made = 3 AND qf.points_earned = 3
    )
  );
