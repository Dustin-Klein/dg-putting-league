-- -- ============================================================================
-- -- 10_seed_data.sql
-- -- Test Data
-- -- ============================================================================
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;


-- DO $$
-- DECLARE
--   v_league_id UUID;
--   v_event_id UUID;
-- BEGIN
--   -- 0. Create Auth User
--   IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'fake@gmail.com') THEN
--     INSERT INTO auth.users (
--       instance_id,
--       id,
--       aud,
--       role,
--       email,
--       encrypted_password,
--       email_confirmed_at,
--       recovery_sent_at,
--       last_sign_in_at,
--       raw_app_meta_data,
--       raw_user_meta_data,
--       created_at,
--       updated_at,
--       confirmation_token,
--       email_change,
--       email_change_token_new,
--       recovery_token
--     ) VALUES (
--       '00000000-0000-0000-0000-000000000000',
--       gen_random_uuid(),
--       'authenticated',
--       'authenticated',
--       'fake@gmail.com',
--       extensions.crypt('password', extensions.gen_salt('bf')),
--       now(),
--       now(),
--       now(),
--       '{"provider":"email","providers":["email"]}',
--       '{}',
--       now(),
--       now(),
--       '',
--       '',
--       '',
--       ''
--     );
--   END IF;

--   -- 1. Insert League
--   INSERT INTO public.leagues (name, city)
--   VALUES ('Test League', 'Test City')
--   RETURNING id INTO v_league_id;

--   -- 2. Assign Owner
--   INSERT INTO public.league_admins (league_id, user_id, role)
--   SELECT v_league_id, id, 'owner'
--   FROM auth.users 
--   WHERE email = 'fake@gmail.com';

--   -- 3. Insert Event
--   INSERT INTO public.events (league_id, event_date, lane_count, putt_distance_ft, access_code, status, entry_fee_per_player, admin_fees)
--   VALUES (v_league_id, CURRENT_DATE, 4, 20.0, 'TEST1234', 'pre-bracket', 10.00, 50.00)
--   RETURNING id INTO v_event_id;

--   -- 4. Insert Players and Register them to the event
--   WITH new_players AS (
--     INSERT INTO public.players (full_name, email)
--     SELECT 
--       'Player ' || i, 
--       'player' || i || '@test.com'
--     FROM generate_series(1, 44) AS i
--     RETURNING id
--   )
--   INSERT INTO public.event_players (event_id, player_id, payment_type)
--   SELECT v_event_id, id, 'cash'
--   FROM new_players;

--   -- 5. Insert Additional Events and register existing players
  
--   -- Event 2: 30 players
--   INSERT INTO public.events (league_id, event_date, lane_count, putt_distance_ft, access_code, status, entry_fee_per_player, admin_fees)
--   VALUES (v_league_id, CURRENT_DATE + 1, 4, 20.0, 'TESTEV02', 'pre-bracket', 10.00, 50.00)
--   RETURNING id INTO v_event_id;

--   INSERT INTO public.event_players (event_id, player_id, payment_type)
--   SELECT v_event_id, id, 'cash'
--   FROM public.players
--   ORDER BY player_number ASC
--   LIMIT 30;

--   -- Event 3: 12 players
--   INSERT INTO public.events (league_id, event_date, lane_count, putt_distance_ft, access_code, status, entry_fee_per_player, admin_fees)
--   VALUES (v_league_id, CURRENT_DATE + 2, 4, 20.0, 'TESTEV03', 'pre-bracket', 10.00, 50.00)
--   RETURNING id INTO v_event_id;

--   INSERT INTO public.event_players (event_id, player_id, payment_type)
--   SELECT v_event_id, id, 'cash'
--   FROM public.players
--   ORDER BY player_number ASC
--   LIMIT 12;

--   -- Event 4: 38 players
--   INSERT INTO public.events (league_id, event_date, lane_count, putt_distance_ft, access_code, status, entry_fee_per_player, admin_fees)
--   VALUES (v_league_id, CURRENT_DATE + 3, 4, 20.0, 'TESTEV04', 'pre-bracket', 10.00, 50.00)
--   RETURNING id INTO v_event_id;

--   INSERT INTO public.event_players (event_id, player_id, payment_type)
--   SELECT v_event_id, id, 'cash'
--   FROM public.players
--   ORDER BY player_number ASC
--   LIMIT 38;

-- END $$;