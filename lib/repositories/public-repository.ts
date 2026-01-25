import { createClient } from '@/lib/supabase/server';
import type { PublicLeague, PublicEvent, PublicLeagueDetail } from '@/lib/types/public';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function getAllLeagues(supabase: SupabaseClient): Promise<PublicLeague[]> {
  const { data: leagues, error } = await supabase
    .from('leagues')
    .select('id, name, description, events(count)')
    .order('name');

  if (error) {
    console.error('Failed to fetch leagues:', error);
    return [];
  }

  if (!leagues) {
    return [];
  }

  return leagues.map((league) => ({
    id: league.id,
    name: league.name,
    description: league.description,
    event_count: league.events[0]?.count ?? 0,
  }));
}

export async function getLeagueWithEvents(
  supabase: SupabaseClient,
  leagueId: string
): Promise<PublicLeagueDetail | null> {
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('id, name, description')
    .eq('id', leagueId)
    .single();

  if (leagueError) {
    console.error('Failed to fetch league:', leagueError);
    return null;
  }

  if (!league) {
    return null;
  }

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, event_date, location, status')
    .eq('league_id', leagueId)
    .order('event_date', { ascending: false });

  if (eventsError) {
    console.error('Failed to fetch events for league:', eventsError);
    return null;
  }

  const eventsWithCounts: PublicEvent[] = await Promise.all(
    (events || []).map(async (event) => {
      const { count } = await supabase
        .from('event_players')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', event.id);

      return {
        id: event.id,
        event_date: event.event_date,
        location: event.location,
        status: event.status,
        participant_count: count ?? 0,
      };
    })
  );

  return {
    id: league.id,
    name: league.name,
    description: league.description,
    event_count: eventsWithCounts.length,
    events: eventsWithCounts,
  };
}
