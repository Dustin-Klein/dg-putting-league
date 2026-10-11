-- ============================================================================
-- Team size and team assignment (plan 07, Decision 1)
--
-- Two orthogonal axes on events: how many players make a bracket entrant
-- (team_size, a number) and how they are chosen (team_assignment). Neither is
-- folded into a combined `format` enum. team_members gains a slot number that
-- replaces the position-as-role column; `role` stays (still written for
-- pool-paired doubles, NULL otherwise) until the UI reading slot +
-- event_players.pool is deployed, then a follow-up migration drops it.
--
-- events.access_code forced column-level SELECT grants on events for clients
-- (security lockdown); the new columns are deliberately not granted, since no
-- client reads events directly. app_server holds table-level privileges.
--
-- Deploy order: team_members.slot is NOT NULL with no default, so app builds from
-- before this change can't start a bracket once it is applied (their team_members
-- inserts omit slot). Apply it together with the app deploy that writes slot, when
-- no event is about to start bracket play.
--
-- Rollback: supabase/rollbacks/202610140000000_team_size_and_assignment.down.sql
-- ============================================================================

-- Axis 1: arity as a number. No enum: 'doubles' | 'singles' is the corner we're avoiding.
ALTER TABLE public.events
  ADD COLUMN team_size smallint NOT NULL DEFAULT 2
    CONSTRAINT events_team_size_check CHECK (team_size BETWEEN 1 AND 4);

-- Axis 2: how members are chosen. Orthogonal to size.
--   random_pairing — the cross-pool draw (doubles only)
--   random_flat    — shuffle all entrants, chunk into teams of team_size; no pools
--   manual         — organizer-supplied
CREATE TYPE team_assignment_type AS ENUM ('random_pairing', 'random_flat', 'manual');
ALTER TABLE public.events
  ADD COLUMN team_assignment team_assignment_type NOT NULL DEFAULT 'random_pairing';

-- No CHECK tying team_assignment to team_size: "random_pairing needs size 2" is a
-- property of one draw algorithm, enforced in team-service.

-- Position within the team. Authoritative for render order and order_in_frame seeding.
ALTER TABLE public.team_members ADD COLUMN slot smallint;

UPDATE public.team_members
SET slot = CASE role WHEN 'A_pool' THEN 1 WHEN 'B_pool' THEN 2 END
WHERE slot IS NULL;

-- Unguarded on purpose: a role = 'alternate' row (never written by the app) has no
-- defined slot or scoring rule, so the migration should fail rather than invent one.
ALTER TABLE public.team_members
  ALTER COLUMN slot SET NOT NULL,
  ADD CONSTRAINT team_members_slot_check CHECK (slot >= 1);

CREATE UNIQUE INDEX team_members_team_slot_key ON public.team_members (team_id, slot);

-- role keeps its CHECK but becomes optional: it is still written ('A_pool'/'B_pool')
-- for pool-paired doubles, and NULL for teams with no pool position (singles,
-- random_flat, manual), which have no truthful value to put there.
ALTER TABLE public.team_members ALTER COLUMN role DROP NOT NULL;
