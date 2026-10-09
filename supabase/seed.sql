-- Local development only: `supabase db reset` / first `supabase start` run this file.
-- It is never applied to hosted projects (`supabase db push` does not seed).

-- Throwaway password for the server role so DATABASE_URL works locally:
--   postgresql://app_server:app_server@127.0.0.1:54322/postgres
ALTER ROLE app_server WITH PASSWORD 'app_server';
