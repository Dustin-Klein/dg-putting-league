import 'server-only';
import { LeagueWithRole, LeagueAdminRole } from '@/lib/types/league';
import type { PublicLeague, PublicLeagueDetail } from '@/lib/types/public';
import { BadRequestError, NotFoundError } from '@/lib/errors';
import {
  authorizeAuthenticated,
  authorizeLeagueCreation,
  authorizeLeagueOwner,
  authorizePublicRead,
  getViewer,
} from '@/lib/services/auth';
import { withTransaction } from '@/lib/db/tx';
import { isUuid } from '@/lib/utils/uuid';
import * as leagueRepo from '@/lib/repositories/league-repository.db';

export interface LeagueAdminWithEmail {
  userId: string;
  email: string;
  role: string;
}

export async function getPublicLeagues(): Promise<PublicLeague[]> {
  const { pg } = authorizePublicRead();
  const viewer = await getViewer();
  return leagueRepo.getAllLeagues(pg, viewer?.id ?? null);
}

export async function getPublicLeagueWithEvents(leagueId: string): Promise<PublicLeagueDetail> {
  const { pg } = authorizePublicRead();
  const viewer = await getViewer();
  const league = isUuid(leagueId)
    ? await leagueRepo.getLeagueWithEvents(pg, leagueId, viewer?.id ?? null)
    : null;

  if (!league) {
    throw new NotFoundError('League not found');
  }

  return league;
}

/**
 * Get league by ID
 */
export async function getLeague(leagueId: string) {
  const { pg } = authorizePublicRead();
  if (!isUuid(leagueId)) return null;
  return leagueRepo.getLeagueById(pg, leagueId);
}

/**
 * Get all leagues where user is an admin with enriched data
 */
export async function getUserAdminLeagues(): Promise<LeagueWithRole[]> {
  const { user, pg } = await authorizeAuthenticated();

  // Admin records
  const adminRecords = await leagueRepo.getLeagueAdminsForUser(pg, user.id);

  if (adminRecords.length === 0) {
    return [];
  }

  const leagueIds = adminRecords.map(a => a.league_id);

  // League details
  const [leagues, stats] = await Promise.all([
    leagueRepo.getLeaguesByIds(pg, leagueIds),
    leagueRepo.getLeagueEventStats(pg, leagueIds),
  ]);
  const statsByLeague = new Map(stats.map((row) => [row.league_id, row]));

  // Enrich leagues
  return leagues.map((league) => {
    const admin = adminRecords.find(a => a.league_id === league.id);
    const leagueStats = statsByLeague.get(league.id);

    return {
      ...league,
      role: (admin?.role ?? 'admin') as LeagueAdminRole,
      eventCount: leagueStats?.event_count ?? 0,
      activeEventCount: leagueStats?.active_event_count ?? 0,
      lastEventDate: leagueStats?.last_event_date ?? null,
    };
  });
}

type CreateLeagueInput = {
  name: string;
  city?: string | null;
};

/**
 * Create a new league with the current user as owner
 */
export async function createLeague(input: CreateLeagueInput) {
  const { user, pg } = await authorizeLeagueCreation();

  const { name, city } = input;

  if (!name || typeof name !== 'string') {
    throw new BadRequestError('League name is required');
  }

  const leagueId = crypto.randomUUID();

  return withTransaction(pg, async (tx) => {
    await leagueRepo.insertLeague(tx, leagueId, name, city ?? null);
    await leagueRepo.insertLeagueAdmin(tx, leagueId, user.id, 'owner');
    return leagueRepo.fetchLeague(tx, leagueId);
  });
}

/**
 * Get all league admins with emails (owner-only)
 */
export async function getLeagueAdminsForOwner(leagueId: string): Promise<LeagueAdminWithEmail[]> {
  const { pg } = await authorizeLeagueOwner(
    leagueId,
    'Only the league owner can view admins'
  );
  const admins = await leagueRepo.getLeagueAdminsWithEmails(pg, leagueId);
  return admins.map((admin) => ({
    userId: admin.user_id,
    email: admin.email ?? 'Unknown',
    role: admin.role,
  }));
}

/**
 * Check if current user is the league owner
 */
export async function checkIsLeagueOwner(leagueId: string): Promise<boolean> {
  const { user, pg } = await authorizeAuthenticated();
  if (!isUuid(leagueId)) return false;
  return (await leagueRepo.getLeagueAdminRole(pg, leagueId, user.id)) === 'owner';
}

/**
 * Delete a league (owner-only)
 */
export async function deleteLeague(leagueId: string): Promise<void> {
  const { pg } = await authorizeLeagueOwner(leagueId, 'Only the league owner can delete the league');

  await leagueRepo.deleteLeague(pg, leagueId);
}

/**
 * Add a league admin by email (owner-only)
 */
export async function addLeagueAdmin(leagueId: string, email: string): Promise<void> {
  const { pg } = await authorizeLeagueOwner(leagueId, 'Only the league owner can add admins');

  const normalizedEmail = (email || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
    throw new BadRequestError('Invalid email format');
  }

  await withTransaction(pg, async (tx) => {
    const targetUserId = await leagueRepo.getUserIdByEmail(tx, normalizedEmail);
    if (!targetUserId) {
      throw new NotFoundError('No account found with that email');
    }

    const existingAdmin = await leagueRepo.getLeagueAdminByUserAndLeague(tx, leagueId, targetUserId);
    if (existingAdmin) {
      throw new BadRequestError('User is already an admin');
    }

    await leagueRepo.insertLeagueAdmin(tx, leagueId, targetUserId, 'admin');
  });
}

/**
 * Remove a league admin (owner-only, can't remove self)
 */
export async function removeLeagueAdmin(leagueId: string, targetUserId: string): Promise<void> {
  const { user, pg } = await authorizeLeagueOwner(leagueId, 'Only the league owner can remove admins');

  if (targetUserId === user.id) {
    throw new BadRequestError('Cannot remove yourself as owner');
  }

  await leagueRepo.deleteLeagueAdmin(pg, leagueId, targetUserId);
}
