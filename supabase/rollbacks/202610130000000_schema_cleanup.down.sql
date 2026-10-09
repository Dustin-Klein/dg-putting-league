-- Emergency rollback for 202610130000000_schema_cleanup.sql.
-- Recreates the dropped (empty) tables and enums with their policies and grants,
-- restores the 'scorer' role value and the role filter in the RLS helpers, and lifts
-- the bracket_match constraints. Orphaned hand-entered match_frames deleted by the
-- migration had no results and are not restored.

ALTER TABLE public.bracket_match DROP CONSTRAINT IF EXISTS bracket_match_status_check;
ALTER TABLE public.bracket_match ALTER COLUMN event_id DROP NOT NULL;

ALTER TYPE public.league_admin_role ADD VALUE IF NOT EXISTS 'scorer';

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
    AND role IN ('owner', 'admin')
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
      AND la.role IN ('owner', 'admin')
  );
$$;

CREATE TYPE public.registration_status AS ENUM ('registered', 'paid', 'withdrawn');
CREATE TYPE public.match_status AS ENUM ('pending', 'ready', 'in_progress', 'completed');
CREATE TYPE public.stat_type AS ENUM (
  'qualification_avg', 'match_win_pct', 'putts_made', 'frames_played', 'streak_best',
  'qualification_total', 'match_points', 'win_count', 'loss_count', 'overtime_wins',
  'overtime_losses', 'avg_points_per_frame', 'total_events_played', 'best_qualification_score',
  'perfect_frames', 'total_participants', 'avg_qualification_score', 'highest_match_score',
  'total_matches_played'
);

CREATE TABLE public.player_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  stat_type public.stat_type NOT NULL,
  value NUMERIC NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, event_id, stat_type)
);
CREATE INDEX idx_player_statistics_player ON public.player_statistics(player_id);
CREATE INDEX idx_player_statistics_league ON public.player_statistics(league_id);
CREATE INDEX idx_player_statistics_event ON public.player_statistics(event_id);

CREATE TABLE public.league_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  stat_type public.stat_type NOT NULL,
  value NUMERIC NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, stat_type, computed_at)
);
CREATE INDEX idx_league_stats_league ON public.league_stats(league_id);

CREATE TABLE public.event_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  stat_type public.stat_type NOT NULL,
  value NUMERIC NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, stat_type, computed_at)
);
CREATE INDEX idx_event_statistics_event ON public.event_statistics(event_id);

ALTER TABLE public.player_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_statistics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable public read for player statistics" ON public.player_statistics
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Enable public read for league stats" ON public.league_stats
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Enable public read for event statistics" ON public.event_statistics
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.player_statistics, public.league_stats, public.event_statistics TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.player_statistics, public.league_stats, public.event_statistics TO app_server;
