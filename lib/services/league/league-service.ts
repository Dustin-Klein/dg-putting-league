import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { LeagueWithRole, LeagueAdminRole } from '@/lib/types/league';
import { BadRequestError } from '@/lib/errors';
import { requireAuthenticatedUser } from '@/lib/services/auth';
import * as leagueRepo from '@/lib/repositories/league-repository';

/**
 * Get league by ID
 */
export async function getLeague(leagueId: string) {
  const supabase = await createClient();
  return leagueRepo.getLeagueById(supabase, leagueId);
}

/**
 * Get all leagues where user is an admin with enriched data
 */
export async function getUserAdminLeagues(userId: string): Promise<LeagueWithRole[]> {
  const supabase = await createClient();

  // Admin records
  const adminRecords = await leagueRepo.getLeagueAdminsForUser(supabase, userId);

  if (adminRecords.length === 0) {
    return [];
  }

  const leagueIds = adminRecords.map(a => a.league_id);

  // League details
  const leagues = await leagueRepo.getLeaguesByIds(supabase, leagueIds);

  // Enrich leagues
  return Promise.all(
    leagues.map(async (league) => {
      const admin = adminRecords.find(a => a.league_id === league.id);

      const [eventCount, activeEventCount, lastEventDate] = await Promise.all([
        leagueRepo.getEventCountForLeague(supabase, league.id),
        leagueRepo.getActiveEventCountForLeague(supabase, league.id),
        leagueRepo.getLastEventDateForLeague(supabase, league.id),
      ]);

      return {
        ...league,
        role: (admin?.role ?? 'admin') as LeagueAdminRole,
        eventCount,
        activeEventCount,
        lastEventDate,
      };
    })
  );
}

type CreateLeagueInput = {
  name: string;
  city?: string | null;
};

/**
 * Create a new league with the current user as owner
 */
export async function createLeague(input: CreateLeagueInput) {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser();

  const { name, city } = input;

  if (!name || typeof name !== 'string') {
    throw new BadRequestError('League name is required');
  }

  // Generate UUID for the new league (avoids RLS issues with RETURNING)
  const leagueId = crypto.randomUUID();

  // Create the league
  await leagueRepo.insertLeague(supabase, leagueId, name, city ?? null);

  // Create the admin record for the owner
  await leagueRepo.insertLeagueAdmin(supabase, leagueId, user.id, 'owner');

  // Now fetch the full league (RLS will allow since user is now an admin)
  return leagueRepo.fetchLeague(supabase, leagueId);
}
