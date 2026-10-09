export function register() {
  // Writes go through the privileged client and the direct Postgres connection;
  // fail at startup instead of on the first write.
  if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_SECRET_KEY is not set. It is required for all database writes.');
  }
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. It is required for transactional database writes.');
  }
}
