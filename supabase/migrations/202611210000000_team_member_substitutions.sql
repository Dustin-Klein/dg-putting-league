-- ============================================================================
-- Team member substitutions: a player swapped onto a team after the bracket exists
--
-- A missed registrant (or anyone replacing a player who leaves) gets an event entry
-- of their own, so they putt from their own zone and distance, and takes the outgoing
-- player's team slot. This table records each swap: the team display shows
-- "outgoing → incoming", and the outgoing entry (kept when it has frames, because
-- frame_results reference it) can be recognised as subbed out.
--
-- out_event_player_id is nullable: an outgoing entry with no frames is deleted in the
-- same transaction, and its name is kept in out_player_id (players are never deleted).
--
-- No client reads this table (the server reads as app_server): RLS with no
-- policies and no client grants.
--
-- Rollback: supabase/rollbacks/202611210000000_team_member_substitutions.down.sql
-- ============================================================================

CREATE TABLE putting_league.team_member_substitutions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             uuid NOT NULL REFERENCES putting_league.events(id) ON DELETE CASCADE,
  team_id              uuid NOT NULL REFERENCES putting_league.teams(id) ON DELETE CASCADE,
  slot                 smallint NOT NULL CHECK (slot >= 1),
  out_player_id        uuid NOT NULL REFERENCES public.players(id),
  out_event_player_id  uuid REFERENCES putting_league.event_players(id) ON DELETE SET NULL,
  in_event_player_id   uuid NOT NULL REFERENCES putting_league.event_players(id) ON DELETE CASCADE,
  reason               text NOT NULL CHECK (reason IN ('missed_registration', 'left_early', 'injury', 'wrong_player')),
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_member_substitutions_event ON putting_league.team_member_substitutions(event_id);
CREATE INDEX idx_team_member_substitutions_team ON putting_league.team_member_substitutions(team_id);

ALTER TABLE putting_league.team_member_substitutions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON putting_league.team_member_substitutions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON putting_league.team_member_substitutions TO app_server;
