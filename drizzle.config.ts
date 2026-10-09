import { defineConfig } from 'drizzle-kit';

// Supabase SQL migrations (supabase/migrations) are the source of truth for the schema.
// `npm run db:pull` introspects the local database into lib/db/schema.ts; never hand-edit it.
// Introspection needs a role that can see every table, so it uses the local `postgres` user.
export default defineConfig({
  dialect: 'postgresql',
  schemaFilter: ['public'],
  out: process.env.DRIZZLE_OUT ?? './drizzle',
  dbCredentials: {
    url: process.env.DRIZZLE_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  },
  introspect: { casing: 'preserve' },
});
