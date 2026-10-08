export function register() {
  // Writes go through the privileged client; fail at startup instead of on the first write.
  if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_SECRET_KEY is not set. It is required for all database writes.');
  }
}
