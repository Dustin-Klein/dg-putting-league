-- Team size and assignment schema tests (plan 07, Decision 1). Run with: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT no_plan();

INSERT INTO public.leagues (id, name) VALUES ('00000000-0000-0000-0000-00000007b001', 'Team Size League');
INSERT INTO public.events (id, league_id, event_date, lane_count, putt_distance_ft, access_code, status)
VALUES ('00000000-0000-0000-0000-00000007c001', '00000000-0000-0000-0000-00000007b001',
        '2026-01-01', 2, 25, 'teamsize1', 'pre-bracket');

-- ---------------------------------------------------------------------------
-- events.team_size / events.team_assignment
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT team_size FROM public.events WHERE id = '00000000-0000-0000-0000-00000007c001'),
  2::smallint,
  'team_size defaults to 2'
);
SELECT is(
  (SELECT team_assignment::text FROM public.events WHERE id = '00000000-0000-0000-0000-00000007c001'),
  'random_pairing',
  'team_assignment defaults to random_pairing'
);

SELECT lives_ok(
  $$ UPDATE public.events SET team_size = 1 WHERE id = '00000000-0000-0000-0000-00000007c001' $$,
  'events_team_size_check allows 1'
);
SELECT lives_ok(
  $$ UPDATE public.events SET team_size = 4 WHERE id = '00000000-0000-0000-0000-00000007c001' $$,
  'events_team_size_check allows 4'
);
SELECT throws_ok(
  $$ UPDATE public.events SET team_size = 0 WHERE id = '00000000-0000-0000-0000-00000007c001' $$,
  '23514', NULL, 'events_team_size_check rejects 0'
);
SELECT throws_ok(
  $$ UPDATE public.events SET team_size = 5 WHERE id = '00000000-0000-0000-0000-00000007c001' $$,
  '23514', NULL, 'events_team_size_check rejects 5'
);

-- No CHECK ties assignment to size: random_pairing at size 3 is a service-layer rule.
SELECT lives_ok(
  $$ UPDATE public.events SET team_size = 3, team_assignment = 'random_pairing'
     WHERE id = '00000000-0000-0000-0000-00000007c001' $$,
  'no constraint couples team_assignment to team_size'
);

-- ---------------------------------------------------------------------------
-- team_members.slot
-- ---------------------------------------------------------------------------

INSERT INTO public.players (id, full_name) VALUES
  ('00000000-0000-0000-0000-00000007d001', 'Slot One'),
  ('00000000-0000-0000-0000-00000007d002', 'Slot Two');
INSERT INTO public.event_players (id, event_id, player_id) VALUES
  ('00000000-0000-0000-0000-00000007e001', '00000000-0000-0000-0000-00000007c001', '00000000-0000-0000-0000-00000007d001'),
  ('00000000-0000-0000-0000-00000007e002', '00000000-0000-0000-0000-00000007c001', '00000000-0000-0000-0000-00000007d002');
INSERT INTO public.teams (id, event_id, seed) VALUES
  ('00000000-0000-0000-0000-00000007f001', '00000000-0000-0000-0000-00000007c001', 1),
  ('00000000-0000-0000-0000-00000007f002', '00000000-0000-0000-0000-00000007c001', 2);
INSERT INTO public.team_members (team_id, event_player_id, role, slot) VALUES
  ('00000000-0000-0000-0000-00000007f001', '00000000-0000-0000-0000-00000007e001', 'A_pool', 1);

SELECT throws_ok(
  $$ INSERT INTO public.team_members (team_id, event_player_id, role, slot)
     VALUES ('00000000-0000-0000-0000-00000007f001', '00000000-0000-0000-0000-00000007e002', 'B_pool', 1) $$,
  '23505', NULL, 'team_members_team_slot_key rejects two members in one slot'
);
SELECT lives_ok(
  $$ INSERT INTO public.team_members (team_id, event_player_id, role, slot)
     VALUES ('00000000-0000-0000-0000-00000007f002', '00000000-0000-0000-0000-00000007e002', 'A_pool', 1) $$,
  'team_members_team_slot_key is per team'
);
SELECT throws_ok(
  $$ INSERT INTO public.team_members (team_id, event_player_id, role)
     VALUES ('00000000-0000-0000-0000-00000007f001', '00000000-0000-0000-0000-00000007e002', 'B_pool') $$,
  '23502', NULL, 'slot is required'
);
SELECT throws_ok(
  $$ INSERT INTO public.team_members (team_id, event_player_id, role, slot)
     VALUES ('00000000-0000-0000-0000-00000007f001', '00000000-0000-0000-0000-00000007e002', 'B_pool', 0) $$,
  '23514', NULL, 'team_members_slot_check rejects slot 0'
);

SELECT lives_ok(
  $$ INSERT INTO public.team_members (team_id, event_player_id, slot)
     VALUES ('00000000-0000-0000-0000-00000007f001', '00000000-0000-0000-0000-00000007e002', 2) $$,
  'role is optional for teams without pool positions'
);

SELECT * FROM finish();
ROLLBACK;
