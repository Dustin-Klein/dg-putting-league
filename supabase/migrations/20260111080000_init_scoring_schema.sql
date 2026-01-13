-- ============================================================================
-- 08_init_scoring_schema.sql
-- Scoring, Statistics, and Game Logic
-- ============================================================================

CREATE TABLE public.match_frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bracket_match_id INTEGER REFERENCES public.bracket_match(id) ON DELETE CASCADE,
  frame_number INTEGER NOT NULL,
  is_overtime BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bracket_match_id, frame_number)
);

CREATE INDEX idx_match_frames_bracket_match ON public.match_frames(bracket_match_id);

CREATE TABLE public.frame_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_frame_id UUID NOT NULL REFERENCES public.match_frames(id) ON DELETE CASCADE,
  event_player_id UUID NOT NULL REFERENCES public.event_players(id) ON DELETE CASCADE,
  bracket_match_id INTEGER REFERENCES public.bracket_match(id) ON DELETE CASCADE,
  putts_made INTEGER NOT NULL CHECK (putts_made BETWEEN 0 AND 3),
  points_earned INTEGER NOT NULL CHECK (points_earned BETWEEN 0 AND 4),
  order_in_frame SMALLINT NOT NULL CHECK (order_in_frame >= 1),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_frame_id, event_player_id)
);

CREATE INDEX idx_frame_results_bracket_match ON public.frame_results(bracket_match_id);
CREATE INDEX IF NOT EXISTS idx_frame_results_event_player_recorded ON public.frame_results(event_player_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_frame_results_match_frame ON public.frame_results(match_frame_id);
CREATE INDEX IF NOT EXISTS idx_frame_results_match_frame_player ON public.frame_results(match_frame_id, event_player_id);

CREATE TABLE public.player_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  stat_type stat_type NOT NULL,
  value NUMERIC NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, event_id, stat_type)
);

CREATE INDEX IF NOT EXISTS idx_player_statistics_player ON public.player_statistics(player_id);
CREATE INDEX IF NOT EXISTS idx_player_statistics_league ON public.player_statistics(league_id);
CREATE INDEX IF NOT EXISTS idx_player_statistics_event ON public.player_statistics(event_id);

CREATE TABLE public.league_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  stat_type stat_type NOT NULL,
  value NUMERIC NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, stat_type, computed_at)
);

CREATE INDEX IF NOT EXISTS idx_league_stats_league ON public.league_stats(league_id);

CREATE TABLE public.event_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  stat_type stat_type NOT NULL,
  value NUMERIC NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, stat_type, computed_at)
);

CREATE INDEX IF NOT EXISTS idx_event_statistics_event ON public.event_statistics(event_id);

ALTER TABLE public.match_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frame_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_statistics ENABLE ROW LEVEL SECURITY;

ALTER PUBLICATION supabase_realtime ADD TABLE public.match_frames;
ALTER PUBLICATION supabase_realtime ADD TABLE public.frame_results;
