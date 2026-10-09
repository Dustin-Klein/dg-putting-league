-- ============================================================================
-- Schema cleanup (plan 05 C9, C10)
--
-- Data-safe per docs/plans/data-review.md (production, 2026-10-07): the three
-- statistics tables have 0 rows, bracket_match.event_id has 0 NULLs, every
-- bracket_match.status is 0-5, and no league_admins row has role 'scorer'.
-- The statements below fail (and the migration rolls back) if that changed.
--
-- Kept: bracket_match_game. brackets-manager reads and deletes match_game rows
-- (get.stageData, delete.stage, updater) even with matchesChildCount = 0, so the
-- storage needs the table. qualification_status stays (qualification_rounds.status).
-- Indexes are not dropped: idx_scan = 0 means nothing at this data size.
--
-- Rollback: supabase/rollbacks/202610130000000_schema_cleanup.down.sql
-- ============================================================================

-- C9: tables and enums the app never reads or writes
DROP TABLE public.player_statistics;
DROP TABLE public.league_stats;
DROP TABLE public.event_statistics;
DROP TYPE public.stat_type;
DROP TYPE public.match_status;
DROP TYPE public.registration_status;

-- C9: every match belongs to an event (DrizzleBracketStorage sets event_id on insert)
ALTER TABLE public.bracket_match ALTER COLUMN event_id SET NOT NULL;

-- brackets-manager Status: Locked 0, Waiting 1, Ready 2, Running 3, Completed 4, Archived 5
ALTER TABLE public.bracket_match
  ADD CONSTRAINT bracket_match_status_check CHECK (status BETWEEN 0 AND 5);

-- C9: hand-entered frames (no bracket match) whose results are gone. They have no
-- path to an event, so earlier event deletes left them behind. The app now deletes
-- them with their event (event-service deleteEvent).
DELETE FROM public.match_frames mf
WHERE mf.bracket_match_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.frame_results fr WHERE fr.match_frame_id = mf.id);

-- C10: one role model. Every league_admins row is a full admin (owner or admin);
-- authorization lives in lib/services/auth. Drop the unused 'scorer' value.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.league_admins WHERE role::text = 'scorer') THEN
    RAISE EXCEPTION 'league_admins has scorer rows; decide how to migrate them before dropping the role';
  END IF;
END $$;

ALTER TYPE public.league_admin_role RENAME TO league_admin_role_old;
CREATE TYPE public.league_admin_role AS ENUM ('owner', 'admin');
ALTER TABLE public.league_admins ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.league_admins
  ALTER COLUMN role TYPE public.league_admin_role USING role::text::public.league_admin_role;
ALTER TABLE public.league_admins ALTER COLUMN role SET DEFAULT 'admin';
DROP TYPE public.league_admin_role_old;

-- RLS helpers: with only owner/admin left, a league_admins row is the admin check.
CREATE OR REPLACE FUNCTION public.is_league_admin(league_id_param uuid, user_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_id = league_id_param
    AND user_id = user_id_param
  );
$$;

CREATE OR REPLACE FUNCTION public.is_league_admin_for_event(event_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE e.id = event_id_param
      AND la.user_id = auth.uid()
  );
$$;
