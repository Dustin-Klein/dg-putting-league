-- ============================================================================
-- 07_init_matches_schema.sql
-- Bracket Match, Participant, and Match Management
-- ============================================================================

CREATE TABLE public.bracket_match (
  id SERIAL PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES public.bracket_stage(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES public.bracket_group(id) ON DELETE CASCADE,
  round_id INTEGER NOT NULL REFERENCES public.bracket_round(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  child_count INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 0,
  opponent1 JSONB,
  opponent2 JSONB,
  lane_id UUID REFERENCES public.lanes(id),
  lane_assigned_at TIMESTAMPTZ,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bracket_match_stage ON public.bracket_match(stage_id);
CREATE INDEX idx_bracket_match_group ON public.bracket_match(group_id);
CREATE INDEX idx_bracket_match_round ON public.bracket_match(round_id);
CREATE INDEX idx_bracket_match_status ON public.bracket_match(status);
CREATE INDEX idx_bracket_match_lane ON public.bracket_match(lane_id);
CREATE INDEX idx_bracket_match_event ON public.bracket_match(event_id);

CREATE TABLE public.bracket_match_game (
  id SERIAL PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES public.bracket_stage(id) ON DELETE CASCADE,
  parent_id INTEGER NOT NULL REFERENCES public.bracket_match(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  opponent1 JSONB,
  opponent2 JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bracket_match_game_parent ON public.bracket_match_game(parent_id);

CREATE TABLE public.bracket_participant (
  id SERIAL PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bracket_participant_tournament ON public.bracket_participant(tournament_id);
CREATE INDEX idx_bracket_participant_team ON public.bracket_participant(team_id);

ALTER TABLE public.bracket_match ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_match_game ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_participant ENABLE ROW LEVEL SECURITY;

ALTER PUBLICATION supabase_realtime ADD TABLE public.bracket_match;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bracket_participant;
