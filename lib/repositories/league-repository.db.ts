import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { league_admins } from '@/lib/db/schema';

export type LeagueAdminRole = (typeof league_admins.$inferSelect)['role'];

/**
 * The user's role in the league, or null when they aren't one of its admins.
 */
export async function getLeagueAdminRole(
  ex: Executor,
  leagueId: string,
  userId: string
): Promise<LeagueAdminRole | null> {
  const rows = await ex
    .select({ role: league_admins.role })
    .from(league_admins)
    .where(and(eq(league_admins.league_id, leagueId), eq(league_admins.user_id, userId)))
    .limit(1);
  return rows[0]?.role ?? null;
}

/**
 * Whether the user is an admin (any role) of at least one league.
 */
export async function isAnyLeagueAdmin(ex: Executor, userId: string): Promise<boolean> {
  const rows = await ex
    .select({ id: league_admins.id })
    .from(league_admins)
    .where(eq(league_admins.user_id, userId))
    .limit(1);
  return rows.length > 0;
}
