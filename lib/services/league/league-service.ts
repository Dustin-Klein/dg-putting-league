import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { LeagueWithRole, LeagueAdminRole } from '@/lib/types/league';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { requireAuthenticatedUser } from '@/lib/services/auth';
import * as leagueRepo from '@/lib/repositories/league-repository';

export interface LeagueAdminWithEmail {
  userId: string;
  email: string;
  role: string;
}

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

/**
 * Get all league admins with emails (owner-only)
 */
export async function getLeagueAdminsForOwner(leagueId: string): Promise<LeagueAdminWithEmail[]> {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser();

  const isOwner = await leagueRepo.isLeagueOwner(supabase, leagueId, user.id);
  if (!isOwner) {
    throw new ForbiddenError('Only the league owner can view admins');
  }

  const admins = await leagueRepo.getLeagueAdmins(supabase, leagueId);

  const adminsWithEmails = await Promise.all(
    admins.map(async (admin) => {
      const email = await leagueRepo.getUserEmailById(supabase, admin.user_id);
      return {
        userId: admin.user_id,
        email: email ?? 'Unknown',
        role: admin.role,
      };
    })
  );

  return adminsWithEmails;
}

/**
 * Check if current user is the league owner
 */
export async function checkIsLeagueOwner(leagueId: string): Promise<boolean> {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser();
  return leagueRepo.isLeagueOwner(supabase, leagueId, user.id);
}

/**
 * Add a league admin by email (owner-only)
 */
export async function addLeagueAdmin(leagueId: string, email: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser();

  const isOwner = await leagueRepo.isLeagueOwner(supabase, leagueId, user.id);
  if (!isOwner) {
    throw new ForbiddenError('Only the league owner can add admins');
  }

  const normalizedEmail = (email || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
    throw new BadRequestError('Invalid email format');
  }

  const targetUserId = await leagueRepo.getUserIdByEmail(supabase, normalizedEmail);
  if (!targetUserId) {
    throw new NotFoundError('No account found with that email');
  }

  const existingAdmin = await leagueRepo.getLeagueAdminByUserAndLeague(supabase, leagueId, targetUserId);
  if (existingAdmin) {
    throw new BadRequestError('User is already an admin');
  }

  await leagueRepo.insertLeagueAdmin(supabase, leagueId, targetUserId, 'admin');
}

/**
 * Remove a league admin (owner-only, can't remove self)
 */
export async function removeLeagueAdmin(leagueId: string, targetUserId: string): Promise<void> {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser();

  const isOwner = await leagueRepo.isLeagueOwner(supabase, leagueId, user.id);
  if (!isOwner) {
    throw new ForbiddenError('Only the league owner can remove admins');
  }

  if (targetUserId === user.id) {
    throw new BadRequestError('Cannot remove yourself as owner');
  }

  await leagueRepo.deleteLeagueAdmin(supabase, leagueId, targetUserId);
}
