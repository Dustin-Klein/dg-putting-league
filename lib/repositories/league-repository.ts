import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';

export interface LeagueData {
  id: string;
  name: string;
  city: string | null;
  created_at: string;
}

export interface LeagueAdminData {
  league_id: string;
  role: string;
}

/**
 * Get league by ID
 */
export async function getLeagueById(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string
): Promise<LeagueData | null> {
  const { data: league, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .single();

  if (error) {
    return null;
  }

  return league as LeagueData;
}

/**
 * Get league admin records for a user
 */
export async function getLeagueAdminsForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<LeagueAdminData[]> {
  const { data: adminRecords, error } = await supabase
    .from('league_admins')
    .select('league_id, role')
    .eq('user_id', userId);

  if (error || !adminRecords) {
    return [];
  }

  return adminRecords as LeagueAdminData[];
}

/**
 * Get leagues by IDs
 */
export async function getLeaguesByIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueIds: string[]
): Promise<LeagueData[]> {
  const { data: leagues, error } = await supabase
    .from('leagues')
    .select('*')
    .in('id', leagueIds);

  if (error) {
    throw error;
  }

  return (leagues || []) as LeagueData[];
}

/**
 * Get event count for a league
 */
export async function getEventCountForLeague(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId);

  if (error) {
    return 0;
  }

  return count ?? 0;
}

/**
 * Get active (non-completed) event count for a league
 */
export async function getActiveEventCountForLeague(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .neq('status', 'completed');

  if (error) {
    return 0;
  }

  return count ?? 0;
}

/**
 * Get last event date for a league
 */
export async function getLastEventDateForLeague(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string
): Promise<string | null> {
  const { data: lastEvent, error } = await supabase
    .from('events')
    .select('event_date')
    .eq('league_id', leagueId)
    .order('event_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  return lastEvent?.event_date ?? null;
}

/**
 * Insert a new league
 */
export async function insertLeague(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string,
  name: string,
  city: string | null
): Promise<void> {
  const { error } = await supabase
    .from('leagues')
    .insert({ id: leagueId, name, city });

  if (error) {
    throw new InternalError(`Failed to create league: ${error.message}`);
  }
}

/**
 * Insert a league admin record
 */
export async function insertLeagueAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string,
  userId: string,
  role: string
): Promise<void> {
  const { error } = await supabase
    .from('league_admins')
    .insert({ league_id: leagueId, user_id: userId, role });

  if (error) {
    throw new InternalError(`Failed to create league admin: ${error.message}`);
  }
}

/**
 * Fetch a league with select fields
 */
export async function fetchLeague(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string
): Promise<LeagueData> {
  const { data: league, error } = await supabase
    .from('leagues')
    .select('id, name, city, created_at')
    .eq('id', leagueId)
    .single();

  if (error || !league) {
    throw new InternalError(`Failed to fetch league: ${error?.message}`);
  }

  return league as LeagueData;
}

/**
 * Get league admin by user and league
 * Returns the admin record if the user is an admin of the league, null otherwise
 */
export async function getLeagueAdminByUserAndLeague(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string,
  userId: string
): Promise<{ id: string } | null> {
  const { data: leagueAdmin, error } = await supabase
    .from('league_admins')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch league admin: ${error.message}`);
  }

  if (!leagueAdmin) {
    return null;
  }

  return leagueAdmin as { id: string };
}
