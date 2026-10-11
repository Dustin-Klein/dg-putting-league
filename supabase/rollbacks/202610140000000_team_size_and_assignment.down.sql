-- Emergency rollback for 202610140000000_team_size_and_assignment.sql.
-- Only safe while no event uses team_size <> 2 or non-random team assignment:
-- the SET NOT NULL fails if any team_members row has no role.

ALTER TABLE public.team_members ALTER COLUMN role SET NOT NULL;
DROP INDEX public.team_members_team_slot_key;
ALTER TABLE public.team_members DROP COLUMN slot;
ALTER TABLE public.events DROP COLUMN team_assignment;
DROP TYPE team_assignment_type;
ALTER TABLE public.events DROP COLUMN team_size;
