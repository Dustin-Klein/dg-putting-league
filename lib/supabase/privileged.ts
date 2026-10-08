import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { PrivilegedClient } from './types';

export type { PrivilegedClient } from './types';

/**
 * Create a Supabase client with the secret key (bypasses RLS).
 *
 * Do not import this outside `lib/services/auth` (enforced by ESLint). Callers get a
 * privileged client only after an authorization check, via the `authorize*` functions.
 */
export function _createPrivilegedClient(): PrivilegedClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error('SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_URL must be set');
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as PrivilegedClient;
}
