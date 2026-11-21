-- ============================================================================
-- Reopening registration after the bracket was created (before any scoring)
--
-- reopened_team_draft keeps the teams that were drawn before registration was
-- reopened, so the next start can keep them and pair only the newcomers:
--   [{ "seed": 1, "members": [{ "event_player_id": "...", "slot": 1, "pool": "A" }, ...] }, ...]
-- Cleared when the bracket starts again. Server-only (read as app_server).
--
-- Rollback: supabase/rollbacks/202611210000002_reopened_team_draft.down.sql
-- ============================================================================

ALTER TABLE putting_league.events
  ADD COLUMN reopened_team_draft jsonb;
