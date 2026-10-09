import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';

/**
 * `app_private.user_emails`: id and email of auth.users, readable only by app_server
 * (migration 202610110000000_app_server_user_emails.sql). Hand-written because
 * `npm run db:pull` only introspects the public schema.
 */
export const user_emails = pgSchema('app_private')
  .view('user_emails', {
    id: uuid().notNull(),
    email: text(),
  })
  .existing();
