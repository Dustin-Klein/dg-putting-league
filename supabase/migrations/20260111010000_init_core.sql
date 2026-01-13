-- ============================================================================
-- 01_init_core.sql
-- Extensions, Enums, Global Types/Sequences
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TYPE league_admin_role AS ENUM ('owner','admin','scorer');
CREATE TYPE registration_status AS ENUM ('registered','paid','withdrawn');
CREATE TYPE pool_type AS ENUM ('A','B');
CREATE TYPE event_status AS ENUM ('created','pre-bracket','bracket','completed');
CREATE TYPE qualification_status AS ENUM ('not_started','in_progress','completed');
CREATE TYPE match_status AS ENUM ('pending','ready','in_progress','completed');
CREATE TYPE lane_status AS ENUM ('idle','occupied','maintenance');
CREATE TYPE stat_type AS ENUM (
  'qualification_avg',
  'match_win_pct',
  'putts_made',
  'frames_played',
  'streak_best',
  'qualification_total',
  'match_points',
  'win_count',
  'loss_count',
  'overtime_wins',
  'overtime_losses',
  'avg_points_per_frame',
  'total_events_played',
  'best_qualification_score',
  'perfect_frames',
  'total_participants',
  'avg_qualification_score',
  'highest_match_score',
  'total_matches_played'
);

CREATE SEQUENCE IF NOT EXISTS public.player_number_seq;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
