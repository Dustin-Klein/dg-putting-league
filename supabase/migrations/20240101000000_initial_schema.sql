-- ============================================================================
-- Disc Golf Putting League Database
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- ENUMS
-- ============================================================================

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
  'match_points'
);

-- ============================================================================
-- TABLES
-- ============================================================================

-- Leagues
CREATE TABLE public.leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (name, city)
);

-- League Admins
CREATE TABLE public.league_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role league_admin_role NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, user_id)
);

-- Player number sequence
CREATE SEQUENCE public.player_number_seq;

-- Players
CREATE TABLE public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_number INTEGER UNIQUE NOT NULL DEFAULT nextval('public.player_number_seq'),
  full_name TEXT NOT NULL,
  nickname TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  default_pool pool_type,
  CONSTRAINT uq_players_email UNIQUE NULLS DISTINCT (email)
);

-- Set sequence to start after the highest existing player number if any
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.players) THEN
    PERFORM setval('public.player_number_seq', COALESCE((SELECT max(player_number) FROM public.players), 0) + 1);
  END IF;
END $$;

CREATE INDEX idx_players_full_name ON public.players USING gin (full_name gin_trgm_ops);

-- Events
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

-- Event Players
CREATE TABLE public.event_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id),
  has_paid BOOLEAN NOT NULL DEFAULT false,
  pool pool_type,
  qualification_seed INTEGER,
  pfa_score NUMERIC(5,2),
  scoring_method TEXT CHECK (scoring_method IN ('qualification', 'pfa', 'default')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, player_id)
);

CREATE INDEX idx_event_players_event ON public.event_players(event_id);

-- Qualification Rounds
CREATE TABLE public.qualification_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  frame_count INTEGER NOT NULL DEFAULT 5,
  created_by UUID REFERENCES auth.users(id),
  status qualification_status NOT NULL DEFAULT 'not_started',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Qualification Frames
CREATE TABLE public.qualification_frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_round_id UUID NOT NULL REFERENCES public.qualification_rounds(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_player_id UUID NOT NULL REFERENCES public.event_players(id) ON DELETE CASCADE,
  frame_number INTEGER NOT NULL CHECK (frame_number > 0),
  putts_made INTEGER NOT NULL CHECK (putts_made BETWEEN 0 AND 3),
  points_earned INTEGER NOT NULL CHECK (points_earned BETWEEN 0 AND 4),
  recorded_by UUID REFERENCES auth.users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_player_id, frame_number)
);

CREATE INDEX idx_qualification_frames_event ON public.qualification_frames(event_id);
CREATE INDEX idx_qualification_rounds_event ON public.qualification_rounds(event_id);

-- Teams
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  seed INTEGER,
  pool_combo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teams_event ON public.teams(event_id);

-- Team Members
CREATE TABLE public.team_members (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  event_player_id UUID NOT NULL REFERENCES public.event_players(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('A_pool','B_pool','alternate')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, event_player_id)
);

-- Lanes
CREATE TABLE public.lanes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  status lane_status NOT NULL DEFAULT 'idle',
  UNIQUE (event_id, label)
);

-- Match Frames (linked directly to bracket_match)
CREATE TABLE public.match_frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bracket_match_id INTEGER,  -- nullable for future qualification matches
  frame_number INTEGER NOT NULL,
  is_overtime BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Note: UNIQUE constraint added after bracket_match table is created
);

-- Frame Results
CREATE TABLE public.frame_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_frame_id UUID NOT NULL REFERENCES public.match_frames(id) ON DELETE CASCADE,
  event_player_id UUID NOT NULL REFERENCES public.event_players(id) ON DELETE CASCADE,
  -- Denormalized bracket_match_id to make score-sync robust on cascade deletes
  -- (FK constraint added after bracket_match table is created)
  bracket_match_id INTEGER,
  putts_made INTEGER NOT NULL CHECK (putts_made BETWEEN 0 AND 3),
  points_earned INTEGER NOT NULL CHECK (points_earned BETWEEN 0 AND 4),
  order_in_frame SMALLINT NOT NULL CHECK (order_in_frame >= 1),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_frame_id, event_player_id)
);

-- Player Statistics
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

-- League Stats
CREATE TABLE public.league_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  stat_type stat_type NOT NULL,
  value NUMERIC NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, stat_type, computed_at)
);

-- ============================================================================
-- BRACKET TABLES (for brackets-manager library)
-- ============================================================================

-- Bracket Stage: represents a bracket stage (double elimination in our case)
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

-- Bracket Group: represents a group within a stage (e.g., winner's bracket, loser's bracket)
CREATE TABLE public.bracket_group (
  id SERIAL PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES public.bracket_stage(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bracket_group_stage ON public.bracket_group(stage_id);

-- Bracket Round: represents a round within a group
CREATE TABLE public.bracket_round (
  id SERIAL PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES public.bracket_stage(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES public.bracket_group(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bracket_round_stage ON public.bracket_round(stage_id);
CREATE INDEX idx_bracket_round_group ON public.bracket_round(group_id);

-- Bracket Match: represents a match within a round (with lane_id and event_id)
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

-- Add foreign key and unique constraint from match_frames to bracket_match after bracket_match table exists
ALTER TABLE public.match_frames
  ADD CONSTRAINT match_frames_bracket_match_id_fkey FOREIGN KEY (bracket_match_id) REFERENCES public.bracket_match(id) ON DELETE CASCADE;

-- Unique constraint: only one frame per frame_number per bracket_match
ALTER TABLE public.match_frames
  ADD CONSTRAINT match_frames_bracket_match_frame_unique UNIQUE (bracket_match_id, frame_number);

CREATE INDEX idx_match_frames_bracket_match ON public.match_frames(bracket_match_id);

-- Add foreign key for denormalized bracket_match_id on frame_results
ALTER TABLE public.frame_results
  ADD CONSTRAINT frame_results_bracket_match_id_fkey FOREIGN KEY (bracket_match_id) REFERENCES public.bracket_match(id) ON DELETE CASCADE;

CREATE INDEX idx_frame_results_bracket_match ON public.frame_results(bracket_match_id);

-- Bracket Match Game: for best-of series (not typically used in our single-match format)
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

-- Bracket Participant: links teams to the bracket system
CREATE TABLE public.bracket_participant (
  id SERIAL PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bracket_participant_tournament ON public.bracket_participant(tournament_id);
CREATE INDEX idx_bracket_participant_team ON public.bracket_participant(team_id);

-- ============================================================================
-- ADDITIONAL INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_league_admins_league_id ON public.league_admins(league_id);
CREATE INDEX IF NOT EXISTS idx_league_admins_user_id ON public.league_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_leagues_created_at ON public.leagues(created_at);
CREATE INDEX IF NOT EXISTS idx_qualification_frames_event_player ON public.qualification_frames(event_player_id);
CREATE INDEX IF NOT EXISTS idx_frame_results_event_player_recorded ON public.frame_results(event_player_id, recorded_at);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to get league event counts
CREATE OR REPLACE FUNCTION public.get_league_event_counts(league_ids uuid[])
RETURNS TABLE (league_id uuid, count bigint)
LANGUAGE sql
AS $$
  SELECT league_id, count(*)
  FROM events
  WHERE league_id = ANY(league_ids)
  GROUP BY league_id;
$$;

-- Function to get active event counts for leagues
CREATE OR REPLACE FUNCTION public.get_league_active_event_counts(league_ids uuid[], status_filter text)
RETURNS TABLE (league_id uuid, count bigint)
LANGUAGE sql
AS $$
  SELECT e.league_id, count(*)
  FROM events e
  WHERE e.league_id = ANY(league_ids)
    AND (e.status IS NULL OR e.status::text != status_filter)
  GROUP BY e.league_id;
$$;

-- Function to check admin status without RLS
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

-- Function to check if user is admin of ANY league
CREATE OR REPLACE FUNCTION public.is_any_league_admin(user_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE user_id = user_id_param
    AND role IN ('owner', 'admin')
  );
$$;

-- Function to check if user is league admin for an event
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

-- Helper function to check admin status via bracket_match -> event
CREATE OR REPLACE FUNCTION public.is_league_admin_for_bracket_match(bracket_match_id_param integer)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bracket_match bm
    JOIN public.events e ON e.id = bm.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE bm.id = bracket_match_id_param
      AND la.user_id = auth.uid()
      AND la.role IN ('owner', 'admin')
  );
$$;

-- Helper function to check admin status via match_frame -> bracket_match -> event
CREATE OR REPLACE FUNCTION public.is_league_admin_for_match_frame(match_frame_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.match_frames mf
    JOIN public.bracket_match bm ON bm.id = mf.bracket_match_id
    JOIN public.events e ON e.id = bm.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE mf.id = match_frame_id_param
      AND la.user_id = auth.uid()
      AND la.role IN ('owner', 'admin')
  );
$$;

-- Helper function to check if user is admin for a tournament (event)
CREATE OR REPLACE FUNCTION public.is_tournament_admin(tournament_id_param UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_league_admin_for_event(tournament_id_param);
$$;

-- Function to calculate team scores from frame_results for a bracket_match
-- Teams are identified via bracket_participant -> team_id
CREATE OR REPLACE FUNCTION public.calculate_bracket_match_scores(p_bracket_match_id INTEGER)
RETURNS TABLE (opponent1_score INTEGER, opponent2_score INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_participant1_id INTEGER;
  v_participant2_id INTEGER;
  v_team1_id UUID;
  v_team2_id UUID;
  v_score1 INTEGER := 0;
  v_score2 INTEGER := 0;
BEGIN
  -- Get participant IDs from bracket_match opponent JSONB
  SELECT
    (opponent1->>'id')::INTEGER,
    (opponent2->>'id')::INTEGER
  INTO v_participant1_id, v_participant2_id
  FROM public.bracket_match WHERE id = p_bracket_match_id;

  -- Get team IDs from participants
  SELECT team_id INTO v_team1_id FROM public.bracket_participant WHERE id = v_participant1_id;
  SELECT team_id INTO v_team2_id FROM public.bracket_participant WHERE id = v_participant2_id;

  IF v_team1_id IS NULL OR v_team2_id IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  -- Calculate team 1 score (sum of both players' points)
  SELECT COALESCE(SUM(fr.points_earned), 0) INTO v_score1
  FROM public.frame_results fr
  JOIN public.match_frames mf ON mf.id = fr.match_frame_id
  JOIN public.team_members tm ON tm.event_player_id = fr.event_player_id
  WHERE mf.bracket_match_id = p_bracket_match_id
    AND tm.team_id = v_team1_id;

  -- Calculate team 2 score
  SELECT COALESCE(SUM(fr.points_earned), 0) INTO v_score2
  FROM public.frame_results fr
  JOIN public.match_frames mf ON mf.id = fr.match_frame_id
  JOIN public.team_members tm ON tm.event_player_id = fr.event_player_id
  WHERE mf.bracket_match_id = p_bracket_match_id
    AND tm.team_id = v_team2_id;

  RETURN QUERY SELECT v_score1, v_score2;
END;
$$;

-- Function to sync bracket_match scores from frame_results
CREATE OR REPLACE FUNCTION public.sync_bracket_match_scores(p_bracket_match_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score1 INTEGER;
  v_score2 INTEGER;
BEGIN
  -- Calculate scores
  SELECT * INTO v_score1, v_score2
  FROM public.calculate_bracket_match_scores(p_bracket_match_id);

  -- Update bracket_match with scores
  UPDATE public.bracket_match
  SET opponent1 = jsonb_set(
        COALESCE(opponent1, '{}'::jsonb),
        '{score}',
        to_jsonb(v_score1)
      ),
      opponent2 = jsonb_set(
        COALESCE(opponent2, '{}'::jsonb),
        '{score}',
        to_jsonb(v_score2)
      ),
      updated_at = NOW()
  WHERE id = p_bracket_match_id;
END;
$$;

-- Trigger function to sync scores when frame_results change
-- Uses denormalized bracket_match_id to avoid lookup failures during cascade deletes
CREATE OR REPLACE FUNCTION public.trigger_sync_bracket_match_scores()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_bracket_match_id INTEGER;
BEGIN
  -- Use denormalized bracket_match_id directly (avoids lookup during cascade deletes)
  IF TG_OP = 'DELETE' THEN
    v_bracket_match_id := OLD.bracket_match_id;
  ELSE
    v_bracket_match_id := NEW.bracket_match_id;
  END IF;

  -- Sync scores if linked to bracket_match
  IF v_bracket_match_id IS NOT NULL THEN
    PERFORM public.sync_bracket_match_scores(v_bracket_match_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Security definer function to get bracket matches for public scoring
CREATE OR REPLACE FUNCTION public.get_scoring_bracket_matches(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT json_agg(
      json_build_object(
        'id', bm.id,
        'status', bm.status,
        'round_id', bm.round_id,
        'number', bm.number
      )
    )
    FROM public.bracket_match bm
    WHERE bm.event_id = p_event_id
    AND bm.status IN (2, 3) -- Ready = 2, Running = 3
  );
END;
$$;

-- Security definer function to update bracket_match for public scoring
-- Bypasses RLS and permission restrictions for anonymous users
CREATE OR REPLACE FUNCTION public.update_bracket_match_score(
  p_match_id INTEGER,
  p_status INTEGER,
  p_opponent1 JSONB,
  p_opponent2 JSONB
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_event_status event_status;
BEGIN
  -- Get the event_id and verify the match exists
  SELECT event_id INTO v_event_id
  FROM public.bracket_match
  WHERE id = p_match_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  -- Verify the event is in bracket status
  SELECT status INTO v_event_status
  FROM public.events
  WHERE id = v_event_id;

  IF v_event_status != 'bracket' THEN
    RAISE EXCEPTION 'Event is not in bracket play';
  END IF;

  -- Update the match
  UPDATE public.bracket_match
  SET status = p_status,
      opponent1 = p_opponent1,
      opponent2 = p_opponent2,
      updated_at = NOW()
  WHERE id = p_match_id;

  RETURN true;
END;
$$;

-- ============================================================================
-- LANE MANAGEMENT RPC FUNCTIONS (Atomic Operations)
-- ============================================================================

-- Atomically assign a lane to a match
-- Returns true if successful, false if lane was already occupied
CREATE OR REPLACE FUNCTION public.assign_lane_to_match(
  p_event_id UUID,
  p_lane_id UUID,
  p_match_id INTEGER
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lane_status lane_status;
  v_event_status event_status;
BEGIN
  -- Verify the event is in bracket status
  SELECT status INTO v_event_status
  FROM public.events
  WHERE id = p_event_id;

  IF v_event_status IS NULL OR v_event_status != 'bracket' THEN
    RAISE EXCEPTION 'Event is not in bracket play';
  END IF;

  -- Lock the lane row and check status
  SELECT status INTO v_lane_status
  FROM public.lanes
  WHERE id = p_lane_id AND event_id = p_event_id
  FOR UPDATE;

  IF v_lane_status IS NULL THEN
    RAISE EXCEPTION 'Lane not found';
  END IF;

  IF v_lane_status != 'idle' THEN
    -- Lane is not available
    RETURN false;
  END IF;

  -- Update lane status to occupied
  UPDATE public.lanes
  SET status = 'occupied'
  WHERE id = p_lane_id;

  -- Assign lane to match (keep current status)
  UPDATE public.bracket_match
  SET lane_id = p_lane_id
  WHERE id = p_match_id AND event_id = p_event_id;

  RETURN true;
END;
$$;

-- Atomically release a lane from a specific match
-- Returns true if successful
CREATE OR REPLACE FUNCTION public.release_match_lane(
  p_event_id UUID,
  p_match_id INTEGER
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lane_id UUID;
BEGIN
  -- Get and lock the lane associated with this match
  SELECT lane_id INTO v_lane_id
  FROM public.bracket_match
  WHERE id = p_match_id AND event_id = p_event_id
  FOR UPDATE;

  IF v_lane_id IS NULL THEN
    -- No lane to release
    RETURN true;
  END IF;

  -- Clear lane from match
  UPDATE public.bracket_match
  SET lane_id = NULL
  WHERE id = p_match_id AND event_id = p_event_id;

  -- Set lane to idle (lock the lane row first)
  UPDATE public.lanes
  SET status = 'idle'
  WHERE id = v_lane_id AND event_id = p_event_id;

  RETURN true;
END;
$$;

-- Atomically set a lane to maintenance mode
-- Returns true if successful
CREATE OR REPLACE FUNCTION public.set_lane_maintenance(
  p_event_id UUID,
  p_lane_id UUID
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Lock and update lane status
  UPDATE public.lanes
  SET status = 'maintenance'
  WHERE id = p_lane_id AND event_id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lane not found';
  END IF;

  -- Clear lane from any matches
  UPDATE public.bracket_match
  SET lane_id = NULL
  WHERE lane_id = p_lane_id AND event_id = p_event_id;

  RETURN true;
END;
$$;

-- Atomically set a lane back to idle
CREATE OR REPLACE FUNCTION public.set_lane_idle(
  p_event_id UUID,
  p_lane_id UUID
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.lanes
  SET status = 'idle'
  WHERE id = p_lane_id AND event_id = p_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lane not found';
  END IF;

  RETURN true;
END;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY - Enable RLS
-- ============================================================================

ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lanes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frame_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_round ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_match ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_match_game ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_participant ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES - Leagues
-- ============================================================================

CREATE POLICY "Enable insert for authenticated users"
ON public.leagues
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Enable read access for league admins"
ON public.leagues
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = leagues.id
    AND league_admins.user_id = auth.uid()
  )
);

CREATE POLICY "Enable update for league admins"
ON public.leagues
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = leagues.id
    AND league_admins.user_id = auth.uid()
    AND league_admins.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Enable delete for league owners"
ON public.leagues
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = leagues.id
    AND league_admins.user_id = auth.uid()
    AND league_admins.role = 'owner'
  )
);

-- ============================================================================
-- RLS POLICIES - League Admins
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.league_admins
FOR SELECT
USING (
  user_id = auth.uid()
  OR public.is_league_admin(league_id, auth.uid())
);

CREATE POLICY "Enable insert for first league admin"
ON public.league_admins
FOR INSERT
WITH CHECK (
  NOT EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_id = league_admins.league_id
  )
  OR
  public.is_league_admin(league_admins.league_id, auth.uid())
);

CREATE POLICY "Enable update for own record"
ON public.league_admins
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Enable delete for own record"
ON public.league_admins
FOR DELETE
USING (user_id = auth.uid() OR public.is_league_admin(league_id, auth.uid()));

-- ============================================================================
-- RLS POLICIES - Players
-- ============================================================================

CREATE POLICY "Enable public read for players"
ON public.players
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Enable insert for league admins"
ON public.players
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_any_league_admin(auth.uid())
);

-- ============================================================================
-- RLS POLICIES - Events
-- ============================================================================

CREATE POLICY "Enable insert for league admins"
ON public.events
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = events.league_id
    AND league_admins.user_id = auth.uid()
    AND league_admins.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Enable read access for league members"
ON public.events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = events.league_id
    AND league_admins.user_id = auth.uid()
  )
);

CREATE POLICY "Enable public read for bracket events"
ON public.events
FOR SELECT
TO anon, authenticated
USING (status = 'bracket');

CREATE POLICY "Enable update for league admins"
ON public.events
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = events.league_id
    AND league_admins.user_id = auth.uid()
    AND league_admins.role IN ('owner', 'admin')
  )
);

CREATE POLICY "Enable delete for league owners"
ON public.events
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.league_admins
    WHERE league_admins.league_id = events.league_id
    AND league_admins.user_id = auth.uid()
    AND league_admins.role = 'owner'
  )
);

-- ============================================================================
-- RLS POLICIES - Event Players
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.event_players
FOR SELECT
USING (
  public.is_league_admin_for_event(event_players.event_id)
);

CREATE POLICY "Enable public read for event players in bracket"
ON public.event_players
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_players.event_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.event_players
FOR INSERT
WITH CHECK (
  public.is_league_admin_for_event(event_players.event_id)
);

CREATE POLICY "Enable update for league admins"
ON public.event_players
FOR UPDATE
USING (
  public.is_league_admin_for_event(event_players.event_id)
)
WITH CHECK (
  public.is_league_admin_for_event(event_players.event_id)
);

CREATE POLICY "Enable delete for league admins"
ON public.event_players
FOR DELETE
USING (
  public.is_league_admin_for_event(event_players.event_id)
);

-- ============================================================================
-- RLS POLICIES - Qualification Rounds
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.qualification_rounds
FOR SELECT
USING (
  public.is_league_admin_for_event(qualification_rounds.event_id)
);

CREATE POLICY "Enable public read for qualification rounds in pre-bracket"
ON public.qualification_rounds
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = qualification_rounds.event_id
    AND e.status = 'pre-bracket'
    AND e.qualification_round_enabled = true
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.qualification_rounds
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_league_admin_for_event(qualification_rounds.event_id)
);

CREATE POLICY "Enable update for league admins"
ON public.qualification_rounds
FOR UPDATE
USING (
  public.is_league_admin_for_event(qualification_rounds.event_id)
);

CREATE POLICY "Enable delete for league admins"
ON public.qualification_rounds
FOR DELETE
USING (
  public.is_league_admin_for_event(qualification_rounds.event_id)
);

-- ============================================================================
-- RLS POLICIES - Qualification Frames
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.qualification_frames
FOR SELECT
USING (
  public.is_league_admin_for_event(qualification_frames.event_id)
);

CREATE POLICY "Enable public read for qualification frames"
ON public.qualification_frames
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = qualification_frames.event_id
    AND e.status = 'pre-bracket'
    AND e.qualification_round_enabled = true
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.qualification_frames
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_league_admin_for_event(qualification_frames.event_id)
);

CREATE POLICY "Enable public insert for qualification scoring"
ON public.qualification_frames
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = qualification_frames.event_id
    AND e.status = 'pre-bracket'
    AND e.qualification_round_enabled = true
  )
);

CREATE POLICY "Enable update for league admins"
ON public.qualification_frames
FOR UPDATE
USING (
  public.is_league_admin_for_event(qualification_frames.event_id)
);

CREATE POLICY "Enable public update for qualification scoring"
ON public.qualification_frames
FOR UPDATE
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = qualification_frames.event_id
    AND e.status = 'pre-bracket'
    AND e.qualification_round_enabled = true
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.qualification_frames
FOR DELETE
USING (
  public.is_league_admin_for_event(qualification_frames.event_id)
);

-- ============================================================================
-- RLS POLICIES - Teams
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.teams
FOR SELECT
USING (
  public.is_league_admin_for_event(teams.event_id)
);

CREATE POLICY "Enable public read for teams in bracket"
ON public.teams
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = teams.event_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.teams
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_league_admin_for_event(teams.event_id)
);

CREATE POLICY "Enable update for league admins"
ON public.teams
FOR UPDATE
USING (
  public.is_league_admin_for_event(teams.event_id)
);

CREATE POLICY "Enable delete for league owners"
ON public.teams
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE e.id = teams.event_id
    AND la.user_id = auth.uid()
    AND la.role = 'owner'
  )
);

-- ============================================================================
-- RLS POLICIES - Team Members
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.team_members
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_members.team_id
    AND public.is_league_admin_for_event(t.event_id)
  )
);

CREATE POLICY "Enable public read for team members in bracket"
ON public.team_members
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.id = team_members.team_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.team_members
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_members.team_id
    AND public.is_league_admin_for_event(t.event_id)
  )
);

CREATE POLICY "Enable update for league admins"
ON public.team_members
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_members.team_id
    AND public.is_league_admin_for_event(t.event_id)
  )
);

CREATE POLICY "Enable delete for league owners"
ON public.team_members
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.events e ON e.id = t.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE t.id = team_members.team_id
    AND la.user_id = auth.uid()
    AND la.role = 'owner'
  )
);

-- ============================================================================
-- RLS POLICIES - Lanes
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.lanes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM events e
    JOIN league_admins la ON la.league_id = e.league_id
    WHERE e.id = lanes.event_id
    AND la.user_id = auth.uid()
  )
);

CREATE POLICY "Enable public read for bracket lanes"
ON public.lanes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = lanes.event_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.lanes FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM events e
    JOIN league_admins la ON la.league_id = e.league_id
    WHERE e.id = lanes.event_id
    AND la.user_id = auth.uid()
  )
);

CREATE POLICY "Enable update for league admins"
ON public.lanes FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM events e
    JOIN league_admins la ON la.league_id = e.league_id
    WHERE e.id = lanes.event_id
    AND la.user_id = auth.uid()
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.lanes FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM events e
    JOIN league_admins la ON la.league_id = e.league_id
    WHERE e.id = lanes.event_id
    AND la.user_id = auth.uid()
  )
);

-- ============================================================================
-- RLS POLICIES - Match Frames
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.match_frames
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_match bm
    JOIN public.events e ON e.id = bm.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE bm.id = match_frames.bracket_match_id
    AND la.user_id = auth.uid()
  )
);

CREATE POLICY "Enable public read for frame scoring"
ON public.match_frames
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_match bm
    JOIN public.events e ON e.id = bm.event_id
    WHERE bm.id = match_frames.bracket_match_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.match_frames
FOR INSERT
WITH CHECK (
  public.is_league_admin_for_bracket_match(match_frames.bracket_match_id)
);

CREATE POLICY "Enable public insert for frame scoring"
ON public.match_frames
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bracket_match bm
    JOIN public.events e ON e.id = bm.event_id
    WHERE bm.id = match_frames.bracket_match_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable update for league admins"
ON public.match_frames
FOR UPDATE
USING (
  public.is_league_admin_for_bracket_match(match_frames.bracket_match_id)
);

CREATE POLICY "Enable delete for league admins"
ON public.match_frames
FOR DELETE
USING (
  public.is_league_admin_for_bracket_match(match_frames.bracket_match_id)
);

-- ============================================================================
-- RLS POLICIES - Frame Results
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.frame_results
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.bracket_match bm ON bm.id = mf.bracket_match_id
    JOIN public.events e ON e.id = bm.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE mf.id = frame_results.match_frame_id
    AND la.user_id = auth.uid()
  )
);

CREATE POLICY "Enable public read for result scoring"
ON public.frame_results
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.bracket_match bm ON bm.id = mf.bracket_match_id
    JOIN public.events e ON e.id = bm.event_id
    WHERE mf.id = frame_results.match_frame_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.frame_results
FOR INSERT
WITH CHECK (
  public.is_league_admin_for_match_frame(frame_results.match_frame_id)
);

CREATE POLICY "Enable public insert for result scoring"
ON public.frame_results
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.bracket_match bm ON bm.id = mf.bracket_match_id
    JOIN public.events e ON e.id = bm.event_id
    WHERE mf.id = frame_results.match_frame_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable update for league admins"
ON public.frame_results
FOR UPDATE
USING (
  public.is_league_admin_for_match_frame(frame_results.match_frame_id)
);

CREATE POLICY "Enable public update for result scoring"
ON public.frame_results
FOR UPDATE
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.bracket_match bm ON bm.id = mf.bracket_match_id
    JOIN public.events e ON e.id = bm.event_id
    WHERE mf.id = frame_results.match_frame_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.frame_results
FOR DELETE
USING (
  public.is_league_admin_for_match_frame(frame_results.match_frame_id)
);

-- ============================================================================
-- RLS POLICIES - Bracket Stage
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.bracket_stage FOR SELECT
USING (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable public read for bracket stages"
ON public.bracket_stage FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_stage.tournament_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_stage FOR INSERT
WITH CHECK (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable update for league admins"
ON public.bracket_stage FOR UPDATE
USING (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable delete for league admins"
ON public.bracket_stage FOR DELETE
USING (public.is_tournament_admin(tournament_id));

-- ============================================================================
-- RLS POLICIES - Bracket Group
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.bracket_group FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_group.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable public read for bracket groups"
ON public.bracket_group FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    JOIN public.events e ON e.id = s.tournament_id
    WHERE s.id = bracket_group.stage_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_group FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_group.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable update for league admins"
ON public.bracket_group FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_group.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.bracket_group FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_group.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

-- ============================================================================
-- RLS POLICIES - Bracket Round
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.bracket_round FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_round.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable public read for bracket rounds"
ON public.bracket_round FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    JOIN public.events e ON e.id = s.tournament_id
    WHERE s.id = bracket_round.stage_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_round FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_round.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable update for league admins"
ON public.bracket_round FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_round.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.bracket_round FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_round.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

-- ============================================================================
-- RLS POLICIES - Bracket Match
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.bracket_match FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable public read for bracket scoring"
ON public.bracket_match
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_match.event_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_match FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable update for league admins"
ON public.bracket_match FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable public update for bracket scoring"
ON public.bracket_match FOR UPDATE
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_match.event_id
    AND e.status = 'bracket'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_match.event_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.bracket_match FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

-- ============================================================================
-- RLS POLICIES - Bracket Match Game
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.bracket_match_game FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match_game.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_match_game FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match_game.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable update for league admins"
ON public.bracket_match_game FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match_game.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

CREATE POLICY "Enable delete for league admins"
ON public.bracket_match_game FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match_game.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

-- ============================================================================
-- RLS POLICIES - Bracket Participant
-- ============================================================================

CREATE POLICY "Enable read access for league admins"
ON public.bracket_participant FOR SELECT
USING (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable public read for bracket participants"
ON public.bracket_participant FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = bracket_participant.tournament_id
    AND e.status = 'bracket'
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.bracket_participant FOR INSERT
WITH CHECK (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable update for league admins"
ON public.bracket_participant FOR UPDATE
USING (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable delete for league admins"
ON public.bracket_participant FOR DELETE
USING (public.is_tournament_admin(tournament_id));

-- ============================================================================
-- EVENT TRANSITION RPC (Atomic Transaction)
-- ============================================================================

-- Atomic function to transition an event from pre-bracket to bracket status
-- This ensures all related data (pools, teams, lanes) is created in a single transaction
-- preventing data inconsistency from partial failures
--
-- Parameters:
-- - p_event_id: The event to transition
-- - p_pool_assignments: Array of {event_player_id, pool, pfa_score, scoring_method}
-- - p_teams: Array of {seed, pool_combo, members: [{event_player_id, role}]}
-- - p_lane_count: Number of lanes to create
--
-- Returns: void (raises exception on failure, which rolls back transaction)
CREATE OR REPLACE FUNCTION public.transition_event_to_bracket(
  p_event_id UUID,
  p_pool_assignments JSONB,
  p_teams JSONB,
  p_lane_count INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status event_status;
  v_pool_assignment JSONB;
  v_team JSONB;
  v_team_id UUID;
  v_member JSONB;
  v_lane_num INTEGER;
BEGIN
  -- 1. Verify current status and lock the event row
  SELECT status INTO v_current_status
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Event not found: %', p_event_id;
  END IF;

  IF v_current_status != 'pre-bracket' THEN
    RAISE EXCEPTION 'Event must be in pre-bracket status to transition. Current status: %', v_current_status;
  END IF;

  -- 2. Update event status to 'bracket'
  UPDATE public.events
  SET status = 'bracket'
  WHERE id = p_event_id;

  -- 3. Apply pool assignments to event_players
  FOR v_pool_assignment IN SELECT * FROM jsonb_array_elements(p_pool_assignments)
  LOOP
    UPDATE public.event_players
    SET pool = (v_pool_assignment->>'pool')::pool_type,
        pfa_score = (v_pool_assignment->>'pfa_score')::NUMERIC,
        scoring_method = v_pool_assignment->>'scoring_method'
    WHERE id = (v_pool_assignment->>'event_player_id')::UUID
      AND event_id = p_event_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Event player not found: %', v_pool_assignment->>'event_player_id';
    END IF;
  END LOOP;

  -- 4. Create teams and team members
  FOR v_team IN SELECT * FROM jsonb_array_elements(p_teams)
  LOOP
    -- Insert team
    INSERT INTO public.teams (event_id, seed, pool_combo)
    VALUES (p_event_id, (v_team->>'seed')::INTEGER, v_team->>'pool_combo')
    RETURNING id INTO v_team_id;

    -- Insert team members
    FOR v_member IN SELECT * FROM jsonb_array_elements(v_team->'members')
    LOOP
      INSERT INTO public.team_members (team_id, event_player_id, role)
      VALUES (
        v_team_id,
        (v_member->>'event_player_id')::UUID,
        v_member->>'role'
      );
    END LOOP;
  END LOOP;

  -- 5. Create lanes if lane_count > 0
  IF p_lane_count > 0 THEN
    -- Check if lanes already exist (idempotent)
    IF NOT EXISTS (SELECT 1 FROM public.lanes WHERE event_id = p_event_id) THEN
      FOR v_lane_num IN 1..p_lane_count
      LOOP
        INSERT INTO public.lanes (event_id, label, status)
        VALUES (p_event_id, 'Lane ' || v_lane_num, 'idle');
      END LOOP;
    END IF;
  END IF;

  -- Transaction commits automatically on success
  -- Any exception above will cause automatic rollback
END;
$$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER trigger_frame_results_sync_scores
AFTER INSERT OR UPDATE OR DELETE ON public.frame_results
FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_bracket_match_scores();

-- ============================================================================
-- REALTIME PUBLICATIONS
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.bracket_match;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bracket_participant;
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_frames;
ALTER PUBLICATION supabase_realtime ADD TABLE public.frame_results;

-- ============================================================================
-- GRANTS AND PERMISSIONS
-- ============================================================================

-- Schema permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Table permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- Sequence permissions
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE bracket_stage_id_seq TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE bracket_group_id_seq TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE bracket_round_id_seq TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE bracket_match_id_seq TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE bracket_match_game_id_seq TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE bracket_participant_id_seq TO postgres, anon, authenticated, service_role;

-- Function permissions
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_scoring_bracket_matches(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_bracket_match_scores(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_bracket_match_scores(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_bracket_match_score(INTEGER, INTEGER, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_lane_to_match(UUID, UUID, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_match_lane(UUID, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_lane_maintenance(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_lane_idle(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_event_to_bracket(UUID, JSONB, JSONB, INTEGER) TO authenticated;

-- Bracket table permissions
-- authenticated users (league admins) get full access, anon users get restricted access for public scoring
GRANT ALL ON public.bracket_stage TO postgres, authenticated, service_role;
GRANT SELECT ON public.bracket_stage TO anon;

GRANT ALL ON public.bracket_group TO postgres, authenticated, service_role;
GRANT SELECT ON public.bracket_group TO anon;

GRANT ALL ON public.bracket_round TO postgres, authenticated, service_role;
GRANT SELECT ON public.bracket_round TO anon;

GRANT ALL ON public.bracket_match TO postgres, authenticated, service_role;
-- anon users can SELECT and UPDATE for public scoring (RLS policies restrict which rows)
GRANT SELECT, UPDATE ON public.bracket_match TO anon;

GRANT ALL ON public.bracket_match_game TO postgres, authenticated, service_role;
GRANT SELECT ON public.bracket_match_game TO anon;

GRANT ALL ON public.bracket_participant TO postgres, authenticated, service_role;
GRANT SELECT ON public.bracket_participant TO anon;
