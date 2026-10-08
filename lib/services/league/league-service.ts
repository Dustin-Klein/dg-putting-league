import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { LeagueWithRole, LeagueAdminRole } from '@/lib/types/league';
import type { PublicLeague, PublicLeagueDetail } from '@/lib/types/public';
import { BadRequestError, ForbiddenError, NotFoundError } from '@/lib/errors';
import {
  requireAuthenticatedUser,
  authorizeLeagueCreation,
  authorizeLeagueOwner,
} from '@/lib/services/auth';
import * as leagueRepo from '@/lib/repositories/league-repository';

export interface LeagueAdminWithEmail {
  userId: string;
  email: string;
  role: string;
}

export async function getPublicLeagues(): Promise<PublicLeague[]> {
  const supabase = await createClient();
  return leagueRepo.getAllLeagues(supabase);
}

export async function getPublicLeagueWithEvents(leagueId: string): Promise<PublicLeagueDetail> {
  const supabase = await createClient();
  const league = await leagueRepo.getLeagueWithEvents(supabase, leagueId);

  if (!league) {
    throw new NotFoundError('League not found');
  }

  return league;
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
  const { user, db } = await authorizeLeagueCreation();

  const { name, city } = input;

  if (!name || typeof name !== 'string') {
    throw new BadRequestError('League name is required');
  }

  const leagueId = crypto.randomUUID();

  // Create the league
  await leagueRepo.insertLeague(db, leagueId, name, city ?? null);

  // Create the admin record for the owner; don't leave an ownerless league behind
  try {
    await leagueRepo.insertLeagueAdmin(db, leagueId, user.id, 'owner');
  } catch (error) {
    await leagueRepo.deleteLeague(db, leagueId).catch(() => undefined);
    throw error;
  }

  return leagueRepo.fetchLeague(db, leagueId);
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
      const email = await leagueRepo.getUserEmailById(supabase, leagueId, admin.user_id);
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
 * Delete a league (owner-only)
 */
export async function deleteLeague(leagueId: string): Promise<void> {
  const { db } = await authorizeLeagueOwner(leagueId, 'Only the league owner can delete the league');

  await leagueRepo.deleteLeague(db, leagueId);
}

/**
 * Add a league admin by email (owner-only)
 */
export async function addLeagueAdmin(leagueId: string, email: string): Promise<void> {
  const { db } = await authorizeLeagueOwner(leagueId, 'Only the league owner can add admins');
  // get_user_id_by_email checks auth.uid() itself, so it runs with the user's client
  const supabase = await createClient();

  const normalizedEmail = (email || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
    throw new BadRequestError('Invalid email format');
  }

  const targetUserId = await leagueRepo.getUserIdByEmail(supabase, leagueId, normalizedEmail);
  if (!targetUserId) {
    throw new NotFoundError('No account found with that email');
  }

  const existingAdmin = await leagueRepo.getLeagueAdminByUserAndLeague(db, leagueId, targetUserId);
  if (existingAdmin) {
    throw new BadRequestError('User is already an admin');
  }

  await leagueRepo.insertLeagueAdmin(db, leagueId, targetUserId, 'admin');
}

/**
 * Remove a league admin (owner-only, can't remove self)
 */
export async function removeLeagueAdmin(leagueId: string, targetUserId: string): Promise<void> {
  const { user, db } = await authorizeLeagueOwner(leagueId, 'Only the league owner can remove admins');

  if (targetUserId === user.id) {
    throw new BadRequestError('Cannot remove yourself as owner');
  }

  await leagueRepo.deleteLeagueAdmin(db, leagueId, targetUserId);
}
