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
  bracket_frame_count INTEGER NOT NULL DEFAULT 5 CHECK (bracket_frame_count > 0 AND bracket_frame_count <= 10),
  qualification_frame_count INTEGER NOT NULL DEFAULT 5 CHECK (qualification_frame_count > 0 AND qualification_frame_count <= 10),
  double_grand_final BOOLEAN NOT NULL DEFAULT true,
  entry_fee_per_player NUMERIC(8,2) DEFAULT NULL,
  admin_fees NUMERIC(8,2) DEFAULT NULL,
  admin_fee_per_player NUMERIC(8,2) DEFAULT NULL,
  payout_pool_override NUMERIC(8,2) DEFAULT NULL,
  payout_structure JSONB DEFAULT NULL,
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
