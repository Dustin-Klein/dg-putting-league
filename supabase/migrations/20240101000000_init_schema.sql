-- Supabase schema DDL for Disc Golf Putting League
-- Run with: supabase db remote commit / psql against your project

-- Extensions (uncomment if not already enabled)
-- create extension if not exists "uuid-ossp";
-- create extension if not exists pgcrypto; -- for gen_random_uuid
create extension if not exists pg_trgm;

-- ENUMS ------------------------------------------------------
create type league_admin_role as enum ('owner','admin','scorer');
create type registration_status as enum ('registered','paid','withdrawn');
create type pool_type as enum ('A','B');
create type event_status as enum ('registration','qualification','bracket','completed');
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

create table public.players (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  nickname text,
  email text,
  created_at timestamptz not null default now(),
  default_pool pool_type,
  constraint uq_players_email unique nulls not distinct (email)
);
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
  status event_status not null default 'registration',
  created_at timestamptz not null default now()
);
create index idx_events_league_date on public.events(league_id, event_date desc);

create table public.event_players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id),
  registration_status registration_status not null default 'registered',
  pool pool_type,
  qualification_seed integer,
  paid_amount numeric(8,2),
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

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  round_name text not null,
  match_order integer not null,
  team_one_id uuid references public.teams(id),
  team_two_id uuid references public.teams(id),
  winner_team_id uuid references public.teams(id),
  status match_status not null default 'pending',
  lane_id uuid references public.lanes(id),
  scheduled_at timestamptz,
  completed_at timestamptz,
  unique (event_id, match_order)
);
create index idx_matches_event_status on public.matches(event_id, status);
create index idx_matches_lane on public.matches(lane_id);

alter table public.lanes
  add constraint lanes_current_match_id_fkey foreign key (current_match_id) references public.matches(id);

create table public.match_lanes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  lane_id uuid not null references public.lanes(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  unique (match_id, lane_id)
);

create table public.match_frames (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
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

-- OPTIONAL AUDIT TABLE ---------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_event on public.audit_events(league_id, event_id, created_at desc);

-- INDEXES FOR LOOKUPS ----------------------------------------
create index idx_event_players_player on public.event_players(player_id);
create index idx_match_frames_match on public.match_frames(match_id);
create index idx_frame_results_player on public.frame_results(event_player_id);
create index idx_player_stats_player on public.player_statistics(player_id);

-- RLS PLACEHOLDER POLICIES -----------------------------------
-- Enable RLS
alter table public.leagues enable row level security;
alter table public.events enable row level security;
alter table public.event_players enable row level security;
alter table public.matches enable row level security;

-- Example policy: league admins can manage their league data
create policy "league admins manage leagues" on public.leagues
  using (exists (
    select 1 from public.league_admins la
    where la.league_id = id and la.user_id = auth.uid()
  ));

create policy "league admins manage events" on public.events
  using (exists (
    select 1 from public.league_admins la
    where la.league_id = events.league_id and la.user_id = auth.uid()
  ));

-- Additional policies should be added per table as needed.
