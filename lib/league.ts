import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { LeagueWithRole } from '@/lib/types/league';
import {
  UnauthorizedError,
  BadRequestError,
  InternalError,
} from '@/lib/errors';

export async function getLeague(
  leagueId: string
) {
  const supabase = await createClient();

  const { data: league, error: leagueError } = await supabase
      .from('leagues')
      .select('*')
      .eq('id', leagueId)
      .single();
  
  return league;
}

export async function getUserAdminLeagues(userId: string): Promise<LeagueWithRole[]> {
  const supabase = await createClient();

  // Admin records
  const { data: adminRecords, error: adminError } = await supabase
    .from('league_admins')
    .select('league_id, role')
    .eq('user_id', userId);

  if (adminError || !adminRecords || adminRecords.length === 0) {
    return [];
  }

  const leagueIds = adminRecords.map(a => a.league_id);

  // League details
  const { data: leagues, error: leaguesError } = await supabase
    .from('leagues')
    .select('*')
    .in('id', leagueIds);

  if (leaguesError || !leagues) {
    throw leaguesError;
  }

  // Enrich leagues
  return Promise.all(
    leagues.map(async (league) => {
      const admin = adminRecords.find(a => a.league_id === league.id);

      const [{ count: eventCount }, { count: activeEventCount }, { data: lastEvent }] =
        await Promise.all([
          supabase
            .from('events')
            .select('*', { count: 'exact', head: true })
            .eq('league_id', league.id),

          supabase
            .from('events')
            .select('*', { count: 'exact', head: true })
            .eq('league_id', league.id)
            .neq('status', 'completed'),

          supabase
            .from('events')
            .select('event_date')
            .eq('league_id', league.id)
            .order('event_date', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

      return {
        ...league,
        role: admin?.role ?? 'member',
        eventCount: eventCount ?? 0,
        activeEventCount: activeEventCount ?? 0,
        lastEventDate: lastEvent?.event_date ?? null,
      };
    })
  );
}

type CreateLeagueInput = {
  name: string;
  city?: string | null;
};

export async function createLeague(input: CreateLeagueInput) {
  const supabase = await createClient();

  // Auth check
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new UnauthorizedError('Authentication required');
  }

  const { name, city } = input;

  if (!name || typeof name !== 'string') {
    throw new BadRequestError('League name is required');
  }

  // Generate UUID for the new league (avoids RLS issues with RETURNING)
  const leagueId = crypto.randomUUID();

  // Create the league
  const { error: leagueError } = await supabase
    .from('leagues')
    .insert({ id: leagueId, name, city: city ?? null });

  if (leagueError) {
    throw new InternalError(`Failed to create league: ${leagueError.message}`);
  }

  // Create the admin record for the owner
  const { error: adminError } = await supabase
    .from('league_admins')
    .insert({ league_id: leagueId, user_id: user.id, role: 'owner' });

  if (adminError) {
    throw new InternalError(`Failed to create league admin: ${adminError.message}`);
  }

  // Now fetch the full league (RLS will allow since user is now an admin)
  const { data: league, error: fetchError } = await supabase
    .from('leagues')
    .select('id, name, city, created_at')
    .eq('id', leagueId)
    .single();

  if (fetchError || !league) {
    throw new InternalError(`Failed to fetch created league: ${fetchError?.message}`);
  }

  return league;
}