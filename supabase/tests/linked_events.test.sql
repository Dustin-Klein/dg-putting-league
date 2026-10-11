-- Linked events schema tests (plan 07, Decision 2). Run with: supabase test db

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT no_plan();

INSERT INTO public.leagues (id, name) VALUES ('00000000-0000-0000-0000-00000008b001', 'Linked Events League');
INSERT INTO public.events (id, league_id, event_date, lane_count, putt_distance_ft, access_code, status)
VALUES ('00000000-0000-0000-0000-00000008c001', '00000000-0000-0000-0000-00000008b001',
        '2026-01-01', 2, 25, 'linkparent1', 'completed');

-- ---------------------------------------------------------------------------
-- events_link_consistent: parent_event_id and link_type are set together
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$ INSERT INTO public.events (league_id, event_date, lane_count, putt_distance_ft, access_code, parent_event_id)
     VALUES ('00000000-0000-0000-0000-00000008b001', '2026-01-01', 2, 25, 'linknotype',
             '00000000-0000-0000-0000-00000008c001') $$,
  '23514', NULL, 'events_link_consistent rejects a parent without a link type'
);
SELECT throws_ok(
  $$ INSERT INTO public.events (league_id, event_date, lane_count, putt_distance_ft, access_code, link_type)
     VALUES ('00000000-0000-0000-0000-00000008b001', '2026-01-01', 2, 25, 'linknoparent', 'second_chance') $$,
  '23514', NULL, 'events_link_consistent rejects a link type without a parent'
);
SELECT lives_ok(
  $$ INSERT INTO public.events (id, league_id, event_date, lane_count, putt_distance_ft, access_code,
                                parent_event_id, link_type, team_size)
     VALUES ('00000000-0000-0000-0000-00000008c002', '00000000-0000-0000-0000-00000008b001',
             '2026-01-01', 2, 25, 'linkchild1', '00000000-0000-0000-0000-00000008c001', 'second_chance', 1) $$,
  'a linked event has both a parent and a link type'
);
SELECT is(
  (SELECT parent_event_id IS NULL AND link_type IS NULL FROM public.events
   WHERE id = '00000000-0000-0000-0000-00000008c001'),
  true,
  'unlinked events have neither'
);

-- ---------------------------------------------------------------------------
-- events_no_self_link
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$ UPDATE public.events
     SET parent_event_id = id, link_type = 'side'
     WHERE id = '00000000-0000-0000-0000-00000008c001' $$,
  '23514', NULL, 'events_no_self_link rejects an event linked to itself'
);
SELECT throws_ok(
  $$ INSERT INTO public.events (id, league_id, event_date, lane_count, putt_distance_ft, access_code,
                                parent_event_id, link_type)
     VALUES ('00000000-0000-0000-0000-00000008c009', '00000000-0000-0000-0000-00000008b001',
             '2026-01-01', 2, 25, 'linkself', '00000000-0000-0000-0000-00000008c009', 'makeup') $$,
  '23514', NULL, 'events_no_self_link rejects a self link on insert'
);

-- ---------------------------------------------------------------------------
-- parent_event_id is ON DELETE RESTRICT
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$ DELETE FROM public.events WHERE id = '00000000-0000-0000-0000-00000008c001' $$,
  '23503', NULL, 'deleting a parent with a linked event is refused (RESTRICT, not CASCADE)'
);
SELECT is(
  (SELECT count(*)::int FROM public.events WHERE id = '00000000-0000-0000-0000-00000008c002'),
  1,
  'the linked event survives the refused delete'
);

SELECT lives_ok(
  $$ DELETE FROM public.events WHERE id = '00000000-0000-0000-0000-00000008c002' $$,
  'a linked event can be deleted on its own'
);
SELECT lives_ok(
  $$ DELETE FROM public.events WHERE id = '00000000-0000-0000-0000-00000008c001' $$,
  'the parent can be deleted once it has no linked events'
);

-- Deleting the league removes parent and child in one statement, which RESTRICT allows.
INSERT INTO public.events (id, league_id, event_date, lane_count, putt_distance_ft, access_code, status)
VALUES ('00000000-0000-0000-0000-00000008c003', '00000000-0000-0000-0000-00000008b001',
        '2026-01-01', 2, 25, 'linkparent2', 'completed');
INSERT INTO public.events (id, league_id, event_date, lane_count, putt_distance_ft, access_code,
                           parent_event_id, link_type)
VALUES ('00000000-0000-0000-0000-00000008c004', '00000000-0000-0000-0000-00000008b001',
        '2026-01-01', 2, 25, 'linkchild2', '00000000-0000-0000-0000-00000008c003', 'second_chance');
SELECT lives_ok(
  $$ DELETE FROM public.leagues WHERE id = '00000000-0000-0000-0000-00000008b001' $$,
  'deleting the league still cascades to linked events'
);

SELECT * FROM finish();
ROLLBACK;
