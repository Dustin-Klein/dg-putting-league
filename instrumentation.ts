export function register() {
  // All server data access uses the direct Postgres connection; fail at startup
  // instead of on the first request.
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. It is required for all database access.');
  }
}
