-- ============================================================================
-- 04_init_events_schema.sql
-- Events table, Lanes
-- ============================================================================

CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  location TEXT,
  lane_count INTEGER NOT NULL CHECK (lane_count > 0),
  putt_distance_ft NUMERIC(5,2) NOT NULL,
  access_code TEXT NOT NULL UNIQUE,
  bonus_point_enabled BOOLEAN NOT NULL DEFAULT true,
  qualification_round_enabled BOOLEAN NOT NULL DEFAULT false,
  status event_status NOT NULL DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_league_date ON public.events(league_id, event_date DESC);

CREATE TABLE public.lanes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  status lane_status NOT NULL DEFAULT 'idle',
  UNIQUE (event_id, label)
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lanes ENABLE ROW LEVEL SECURITY;
