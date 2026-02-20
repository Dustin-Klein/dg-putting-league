-- ============================================================================
-- 05_init_participation.sql
-- Event Players, Teams, Team Members
-- ============================================================================

CREATE TABLE public.event_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id),
  payment_type TEXT CHECK (payment_type IN ('cash', 'electronic')),
  pool pool_type,
  qualification_seed INTEGER,
  pfa_score NUMERIC(5,2),
  scoring_method TEXT CHECK (scoring_method IN ('qualification', 'pfa', 'default')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, player_id)
);

CREATE INDEX idx_event_players_event ON public.event_players(event_id);
CREATE INDEX idx_event_players_player ON public.event_players(player_id);

CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  seed INTEGER,
  pool_combo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teams_event ON public.teams(event_id);

CREATE TABLE public.team_members (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  event_player_id UUID NOT NULL REFERENCES public.event_players(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('A_pool','B_pool','alternate')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, event_player_id)
);

CREATE INDEX idx_team_members_event_player ON public.team_members(event_player_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON public.team_members(team_id);

ALTER TABLE public.event_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for admins or scoring events"
ON public.event_players
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_players.event_id
    AND (
      e.status = 'bracket'
      OR e.status = 'completed'
      OR (e.status = 'pre-bracket' AND e.qualification_round_enabled = true)
    )
  )
  OR public.is_league_admin_for_event(event_players.event_id)
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

CREATE POLICY "Enable read for admins or bracket events"
ON public.teams
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = teams.event_id
    AND (e.status = 'bracket' OR e.status = 'completed')
  )
  OR public.is_league_admin_for_event(teams.event_id)
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
    AND la.user_id = (select auth.uid())
    AND la.role = 'owner'
  )
);

CREATE POLICY "Enable read for admins or bracket events"
ON public.team_members
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.id = team_members.team_id
    AND (e.status = 'bracket' OR e.status = 'completed')
  )
  OR EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_members.team_id
    AND public.is_league_admin_for_event(t.event_id)
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
    AND la.user_id = (select auth.uid())
    AND la.role = 'owner'
  )
);
