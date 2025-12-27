-- Bracket tables for brackets-manager library
-- These tables store the bracket structure and match data

-- Stage table: represents a bracket stage (double elimination in our case)
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

-- Group table: represents a group within a stage (e.g., winner's bracket, loser's bracket)
CREATE TABLE public.bracket_group (
  id SERIAL PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES public.bracket_stage(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bracket_group_stage ON public.bracket_group(stage_id);

-- Round table: represents a round within a group
CREATE TABLE public.bracket_round (
  id SERIAL PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES public.bracket_stage(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES public.bracket_group(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bracket_round_stage ON public.bracket_round(stage_id);
CREATE INDEX idx_bracket_round_group ON public.bracket_round(group_id);

-- Match table: represents a match within a round
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bracket_match_stage ON public.bracket_match(stage_id);
CREATE INDEX idx_bracket_match_group ON public.bracket_match(group_id);
CREATE INDEX idx_bracket_match_round ON public.bracket_match(round_id);
CREATE INDEX idx_bracket_match_status ON public.bracket_match(status);

-- Match game table: for best-of series (not typically used in our single-match format)
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

-- Participant table: links teams to the bracket system
CREATE TABLE public.bracket_participant (
  id SERIAL PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bracket_participant_tournament ON public.bracket_participant(tournament_id);
CREATE INDEX idx_bracket_participant_team ON public.bracket_participant(team_id);

-- Enable RLS on all bracket tables
ALTER TABLE public.bracket_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_round ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_match ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_match_game ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_participant ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is admin for a tournament (event)
CREATE OR REPLACE FUNCTION public.is_tournament_admin(tournament_id_param UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_league_admin_for_event(tournament_id_param);
$$;

-- RLS Policies for bracket_stage
CREATE POLICY "Enable read access for league admins"
ON public.bracket_stage FOR SELECT
USING (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable insert for league admins"
ON public.bracket_stage FOR INSERT
WITH CHECK (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable update for league admins"
ON public.bracket_stage FOR UPDATE
USING (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable delete for league admins"
ON public.bracket_stage FOR DELETE
USING (public.is_tournament_admin(tournament_id));

-- RLS Policies for bracket_group
CREATE POLICY "Enable read access for league admins"
ON public.bracket_group FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_group.stage_id
    AND public.is_tournament_admin(s.tournament_id)
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

-- RLS Policies for bracket_round
CREATE POLICY "Enable read access for league admins"
ON public.bracket_round FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_round.stage_id
    AND public.is_tournament_admin(s.tournament_id)
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

-- RLS Policies for bracket_match
CREATE POLICY "Enable read access for league admins"
ON public.bracket_match FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match.stage_id
    AND public.is_tournament_admin(s.tournament_id)
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

CREATE POLICY "Enable delete for league admins"
ON public.bracket_match FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.bracket_stage s
    WHERE s.id = bracket_match.stage_id
    AND public.is_tournament_admin(s.tournament_id)
  )
);

-- RLS Policies for bracket_match_game
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

-- RLS Policies for bracket_participant
CREATE POLICY "Enable read access for league admins"
ON public.bracket_participant FOR SELECT
USING (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable insert for league admins"
ON public.bracket_participant FOR INSERT
WITH CHECK (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable update for league admins"
ON public.bracket_participant FOR UPDATE
USING (public.is_tournament_admin(tournament_id));

CREATE POLICY "Enable delete for league admins"
ON public.bracket_participant FOR DELETE
USING (public.is_tournament_admin(tournament_id));

-- Public read policies for bracket tables when event is in bracket status
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

-- Add lane assignment to bracket_match for tracking which lane a match is on
ALTER TABLE public.bracket_match ADD COLUMN lane_id UUID REFERENCES public.lanes(id);
ALTER TABLE public.bracket_match ADD COLUMN event_id UUID REFERENCES public.events(id) ON DELETE CASCADE;

-- Create index for lane lookup
CREATE INDEX idx_bracket_match_lane ON public.bracket_match(lane_id);
CREATE INDEX idx_bracket_match_event ON public.bracket_match(event_id);

-- Enable realtime for bracket tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.bracket_match;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bracket_participant;

-- Grant permissions
GRANT ALL ON public.bracket_stage TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.bracket_group TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.bracket_round TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.bracket_match TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.bracket_match_game TO postgres, anon, authenticated, service_role;
GRANT ALL ON public.bracket_participant TO postgres, anon, authenticated, service_role;

-- Grant sequence permissions
GRANT USAGE, SELECT ON SEQUENCE bracket_stage_id_seq TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE bracket_group_id_seq TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE bracket_round_id_seq TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE bracket_match_id_seq TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE bracket_match_game_id_seq TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE bracket_participant_id_seq TO postgres, anon, authenticated, service_role;
