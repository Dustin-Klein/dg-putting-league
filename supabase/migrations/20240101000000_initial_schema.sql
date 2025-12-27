-- Extensions
create extension if not exists pg_trgm;

-- ENUMS ------------------------------------------------------
create type league_admin_role as enum ('owner','admin','scorer');
create type registration_status as enum ('registered','paid','withdrawn');
create type pool_type as enum ('A','B');
create type event_status as enum ('created','pre-bracket','bracket','completed');
create type qualification_status as enum ('not_started','in_progress','completed');
create type match_status as enum ('pending','ready','in_progress','completed');
create type lane_status as enum ('idle','occupied','maintenance');
create type stat_type as enum (
  'qualification_avg',
  'match_win_pct',
  'putts_made',
  'frames_played',
  'streak_best',
  'qualification_total',
  'match_points'
);

-- TABLES -----------------------------------------------------

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  unique (name, city)
);

create table public.league_admins (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role league_admin_role not null default 'admin',
  created_at timestamptz not null default now(),
  unique (league_id, user_id)
);

-- Create sequence for player numbers
create sequence public.player_number_seq;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  player_number integer unique not null default nextval('public.player_number_seq'),
  full_name text not null,
  nickname text,
  email text,
  created_at timestamptz not null default now(),
  default_pool pool_type,
  constraint uq_players_email unique nulls not distinct (email)
);

-- Set sequence to start after the highest existing player number if any
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.players) THEN
    PERFORM setval('public.player_number_seq', COALESCE((SELECT max(player_number) FROM public.players), 0) + 1);
  END IF;
END $$;
create index idx_players_full_name on public.players using gin (full_name gin_trgm_ops);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  event_date date not null,
  location text,
  lane_count integer not null check (lane_count > 0),
  putt_distance_ft numeric(5,2) not null,
  access_code text not null unique,
  bonus_point_enabled boolean not null default true,
  qualification_round_enabled boolean not null default false,
  status event_status not null default 'created',
  created_at timestamptz not null default now()
);
create index idx_events_league_date on public.events(league_id, event_date desc);

create table public.event_players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id),
  has_paid boolean not null default false,
  pool pool_type,
  qualification_seed integer,
  pfa_score numeric(5,2),
  scoring_method text check (scoring_method in ('qualification', 'pfa', 'default')),
  created_at timestamptz not null default now(),
  unique (event_id, player_id)
);
create index idx_event_players_event on public.event_players(event_id);

create table public.qualification_rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  frame_count integer not null default 5,
  created_by uuid references auth.users(id),
  status qualification_status not null default 'not_started',
  created_at timestamptz not null default now()
);

create table public.qualification_frames (
  id uuid primary key default gen_random_uuid(),
  qualification_round_id uuid not null references public.qualification_rounds(id) on delete cascade,
  event_player_id uuid not null references public.event_players(id) on delete cascade,
  frame_number integer not null check (frame_number > 0),
  putts_made integer not null check (putts_made between 0 and 3),
  points_earned integer not null check (points_earned between 0 and 4),
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique (event_player_id, frame_number)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  seed integer,
  pool_combo text,
  created_at timestamptz not null default now()
);
create index idx_teams_event on public.teams(event_id);

create table public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  event_player_id uuid not null references public.event_players(id) on delete cascade,
  role text not null check (role in ('A_pool','B_pool','alternate')),
  joined_at timestamptz not null default now(),
  primary key (team_id, event_player_id)
);

create table public.lanes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null,
  current_match_id uuid,
  status lane_status not null default 'idle',
  unique (event_id, label)
);

create table public.match (
  id uuid primary key default gen_random_uuid(),

  -- Event relationship
  event_id uuid not null
    references public.events(id)
    on delete cascade,

  -- Display / ordering
  round_name text not null,
  round_number integer not null default 1,
  match_order integer not null,

  -- Bracket metadata
  bracket_side text
    check (bracket_side in ('upper','lower','final')),

  is_reset_final boolean not null default false,

  -- Teams
  team_one_id uuid references public.teams(id),
  team_two_id uuid references public.teams(id),
  winner_team_id uuid references public.teams(id),

  -- Bracket progression
  next_match_win_id uuid references public.match(id),

  next_match_lose_id uuid references public.match(id),

  -- Match state
  status match_status not null default 'pending',

  -- Lane scheduling
  lane_id uuid references public.lanes(id),
  scheduled_at timestamptz,
  completed_at timestamptz,

  -- Constraints
  unique (event_id, match_order)
);

create index idx_match_event_bracket
  on public.match(event_id, bracket_side, round_number);

create index idx_match_next_match_win
  on public.match(next_match_win_id);

create index idx_match_next_match_lose
  on public.match(next_match_lose_id);

create index idx_match_lane
  on public.match(lane_id);


alter table public.lanes
  add constraint lanes_current_match_id_fkey foreign key (current_match_id) references public.match
(id);

create table public.match_lanes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.match
(id) on delete cascade,
  lane_id uuid not null references public.lanes(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  unique (match_id, lane_id)
);

create table public.match_frames (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.match
(id) on delete cascade,
  frame_number integer not null,
  is_overtime boolean not null default false,
  created_at timestamptz not null default now(),
  unique (match_id, frame_number)
);

create table public.frame_results (
  id uuid primary key default gen_random_uuid(),
  match_frame_id uuid not null references public.match_frames(id) on delete cascade,
  event_player_id uuid not null references public.event_players(id) on delete cascade,
  putts_made integer not null check (putts_made between 0 and 3),
  points_earned integer not null check (points_earned between 0 and 4),
  order_in_frame smallint not null check (order_in_frame >= 1),
  recorded_at timestamptz not null default now(),
  unique (match_frame_id, event_player_id)
);

create table public.player_statistics (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  stat_type stat_type not null,
  value numeric not null,
  computed_at timestamptz not null default now(),
  unique (player_id, event_id, stat_type)
);

create table public.league_stats (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  stat_type stat_type not null,
  value numeric not null,
  computed_at timestamptz not null default now(),
  unique (league_id, stat_type, computed_at)
);

-- Custom Functions -------------------------------------------

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

-- ROW LEVEL SECURITY -----------------------------------------

-- Enable RLS on all tables
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualification_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lanes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_lanes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frame_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_stats ENABLE ROW LEVEL SECURITY;

-- RLS Policies for leagues
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

-- Create a security definer function to check admin status without RLS
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

-- RLS Policies for league_admins
-- Enable read access for users who are admins of the league
CREATE POLICY "Enable read access for league admins" 
ON public.league_admins
FOR SELECT
USING (
  user_id = auth.uid()
  OR public.is_league_admin(league_id, auth.uid())
);

-- Enable insert for authenticated users with a special check for the first admin
CREATE POLICY "Enable insert for first league admin" 
ON public.league_admins
FOR INSERT
WITH CHECK (
  -- Allow if there are no admins for this league yet (first admin)
  NOT EXISTS (
    SELECT 1 FROM public.league_admins 
    WHERE league_id = league_admins.league_id
  )
  OR 
  -- Or if the user is an existing admin of this league
  public.is_league_admin(league_admins.league_id, auth.uid())
);

-- Enable update for admins to update their own records
CREATE POLICY "Enable update for own record"
ON public.league_admins
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Enable delete for admins to remove themselves (but not others)
CREATE POLICY "Enable delete for own record"
ON public.league_admins
FOR DELETE
USING (user_id = auth.uid() OR public.is_league_admin(league_id, auth.uid()));

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
-- Create policy to allow league admins to insert events
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

-- Create policy to allow reading events for league members
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

-- Allow public read for events in bracket status (for public scoring)
CREATE POLICY "Enable public read for bracket events"
ON public.events
FOR SELECT
TO anon, authenticated
USING (status = 'bracket');

-- Enable update for league admins
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

-- Enable delete for league owners
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

-- Create RLS policies for event_players table

CREATE OR REPLACE FUNCTION public.is_league_admin_for_event(
  event_id_param uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    JOIN public.league_admins la
      ON la.league_id = e.league_id
    WHERE e.id = event_id_param
      AND la.user_id = auth.uid()
      AND la.role IN ('owner', 'admin')
  );
$$;

CREATE POLICY "Enable read access for league admins"
ON public.event_players
FOR SELECT
USING (
  public.is_league_admin_for_event(event_players.event_id)
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

-- RLS Policies for teams table

-- Enable read access for league admins
CREATE POLICY "Enable read access for league admins" 
ON public.teams
FOR SELECT
USING (
  public.is_league_admin_for_event(teams.event_id)
);

-- Enable insert for league admins
CREATE POLICY "Enable insert for league admins" 
ON public.teams
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_league_admin_for_event(teams.event_id)
);

-- Enable update for league admins
CREATE POLICY "Enable update for league admins" 
ON public.teams
FOR UPDATE
USING (
  public.is_league_admin_for_event(teams.event_id)
);

-- Enable delete for league owners
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

-- RLS Policies for team_members table

-- Enable read access for league admins
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

-- Enable insert for league admins
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

-- Enable update for league admins
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

-- Enable delete for league owners
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

-- RLS Policies for match_frames table

-- Helper function to check admin status via match -> event
CREATE OR REPLACE FUNCTION public.is_league_admin_for_match(match_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.match m
    JOIN public.events e ON e.id = m.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE m.id = match_id_param
      AND la.user_id = auth.uid()
      AND la.role IN ('owner', 'admin')
  );
$$;

CREATE POLICY "Enable read access for league admins"
ON public.match_frames
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.match m
    JOIN public.events e ON e.id = m.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE m.id = match_frames.match_id
    AND la.user_id = auth.uid()
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.match_frames
FOR INSERT
WITH CHECK (
  public.is_league_admin_for_match(match_frames.match_id)
);

CREATE POLICY "Enable update for league admins"
ON public.match_frames
FOR UPDATE
USING (
  public.is_league_admin_for_match(match_frames.match_id)
);

CREATE POLICY "Enable delete for league admins"
ON public.match_frames
FOR DELETE
USING (
  public.is_league_admin_for_match(match_frames.match_id)
);

-- RLS Policies for frame_results table

-- Helper function to check admin status via match_frame -> match -> event
CREATE OR REPLACE FUNCTION public.is_league_admin_for_match_frame(match_frame_id_param uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.match_frames mf
    JOIN public.match m ON m.id = mf.match_id
    JOIN public.events e ON e.id = m.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE mf.id = match_frame_id_param
      AND la.user_id = auth.uid()
      AND la.role IN ('owner', 'admin')
  );
$$;

CREATE POLICY "Enable read access for league admins"
ON public.frame_results
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.match_frames mf
    JOIN public.match m ON m.id = mf.match_id
    JOIN public.events e ON e.id = m.event_id
    JOIN public.league_admins la ON la.league_id = e.league_id
    WHERE mf.id = frame_results.match_frame_id
    AND la.user_id = auth.uid()
  )
);

CREATE POLICY "Enable insert for league admins"
ON public.frame_results
FOR INSERT
WITH CHECK (
  public.is_league_admin_for_match_frame(frame_results.match_frame_id)
);

CREATE POLICY "Enable update for league admins"
ON public.frame_results
FOR UPDATE
USING (
  public.is_league_admin_for_match_frame(frame_results.match_frame_id)
);

CREATE POLICY "Enable delete for league admins"
ON public.frame_results
FOR DELETE
USING (
  public.is_league_admin_for_match_frame(frame_results.match_frame_id)
);

-- GRANTS -----------------------------------------------------

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_league_admins_league_id ON public.league_admins(league_id);
CREATE INDEX IF NOT EXISTS idx_league_admins_user_id ON public.league_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_leagues_created_at ON public.leagues(created_at);
CREATE INDEX IF NOT EXISTS idx_qualification_frames_event_player ON public.qualification_frames(event_player_id);
CREATE INDEX IF NOT EXISTS idx_frame_results_event_player_recorded ON public.frame_results(event_player_id, recorded_at);
