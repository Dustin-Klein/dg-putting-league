import type { SupabaseClient } from '@supabase/supabase-js';

declare const privilegedBrand: unique symbol;

/**
 * A Supabase client authenticated with the secret (service-role) key. It bypasses
 * RLS and is the only client allowed to write or call business RPCs.
 *
 * The brand makes it impossible to pass a user-scoped client where a privileged
 * one is required. Obtain one only through the `authorize*` functions in
 * `lib/services/auth`, which perform the authorization check first.
 */
export type PrivilegedClient = SupabaseClient & { readonly [privilegedBrand]: 'privileged' };
