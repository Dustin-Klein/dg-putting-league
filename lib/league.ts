import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { LeagueWithRole } from '@/app/leagues/types';

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
