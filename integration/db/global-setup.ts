// Runs once before the integration suite. Against the local stack (no
// TEST_DATABASE_URL given), make sure the app_server role can log in with the
// throwaway local password that supabase/seed.sql sets on `db reset`.
import postgres from 'postgres';

export default async function globalSetup(): Promise<void> {
  if (process.env.TEST_DATABASE_URL) return;
  const admin = postgres(
    process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1, onnotice: () => {} }
  );
  try {
    await admin.unsafe("ALTER ROLE app_server WITH PASSWORD 'app_server'");
  } finally {
    await admin.end();
  }
}
