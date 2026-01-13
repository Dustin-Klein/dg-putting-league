-- ============================================================================
-- 06_init_brackets_schema.sql
-- Bracket Structure
-- ============================================================================

CREATE TABLE public.bracket_stage (
  id SERIAL PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('single_elimination', 'double_elimination', 'round_robin')),
  settings JSONB NOT NULL DEFAULT '{}',
  number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bracket_stage_tournament ON public.bracket_stage(tournament_id);

CREATE TABLE public.bracket_group (
  id SERIAL PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES public.bracket_stage(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bracket_group_stage ON public.bracket_group(stage_id);

CREATE TABLE public.bracket_round (
  id SERIAL PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES public.bracket_stage(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES public.bracket_group(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bracket_round_stage ON public.bracket_round(stage_id);
CREATE INDEX idx_bracket_round_group ON public.bracket_round(group_id);

ALTER TABLE public.bracket_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_round ENABLE ROW LEVEL SECURITY;
