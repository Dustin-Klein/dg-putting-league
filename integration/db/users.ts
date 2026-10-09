/**
 * Auth users for integration tests. app_server can't write auth.users, so these
 * use the local `postgres` superuser and commit; delete them in `afterAll`.
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export interface TestUsers {
  create(email?: string): Promise<{ id: string; email: string }>;
  cleanup(): Promise<void>;
}

export function testUsers(): TestUsers {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  const ids: string[] = [];
  return {
    async create(email = `it-${randomUUID()}@example.test`) {
      const id = randomUUID();
      await admin`
        insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
        values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                ${email}, now(), now())`;
      ids.push(id);
      return { id, email };
    },
    async cleanup() {
      try {
        if (ids.length > 0) await admin`delete from auth.users where id in ${admin(ids)}`;
      } finally {
        await admin.end();
      }
    },
  };
}
