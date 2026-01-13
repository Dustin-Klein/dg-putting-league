-- ============================================================================
-- 02_init_players.sql
-- Players table and self-management RLS
-- ============================================================================

CREATE TABLE public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_number INTEGER UNIQUE NOT NULL DEFAULT nextval('public.player_number_seq'),
  full_name TEXT NOT NULL,
  nickname TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  default_pool pool_type
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.players) THEN
    PERFORM setval('public.player_number_seq', COALESCE((SELECT max(player_number) FROM public.players), 0) + 1);
  END IF;
END $$;

CREATE INDEX idx_players_full_name ON public.players USING gin (full_name extensions.gin_trgm_ops);

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable public read for players"
ON public.players
FOR SELECT
TO anon, authenticated
USING (true);
