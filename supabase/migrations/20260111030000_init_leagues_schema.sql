-- ============================================================================
-- 03_init_leagues_schema.sql
-- Leagues, League Admins Schema
-- ============================================================================

CREATE TABLE public.leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (name, city)
);

CREATE TABLE public.league_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role league_admin_role NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_league_admins_league_id ON public.league_admins(league_id);
CREATE INDEX IF NOT EXISTS idx_league_admins_user_id ON public.league_admins(user_id);

ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_admins ENABLE ROW LEVEL SECURITY;
