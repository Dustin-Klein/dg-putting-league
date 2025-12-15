import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { EventsContent } from './events-content';

export default async function LeagueEventsPage({ 
  params: paramsPromise 
}: { 
  params: Promise<{ leagueId: string }> | { leagueId: string }
}) {
  // Ensure params is resolved if it's a Promise
  const params = await Promise.resolve(paramsPromise);
  const leagueId = params.leagueId;
  
  const supabase = await createClient();
  
  // Check if user is authenticated
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    redirect('/auth/sign-in');
  }

  // Check if user is an admin of this league
  const { data: leagueAdmin, error: adminError } = await supabase
    .from('league_admins')
    .select('*')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (adminError || !leagueAdmin) {
    redirect('/leagues');
  }
  
  const isAdmin = !!leagueAdmin;

  // Fetch league details
  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', params.leagueId)
    .single();

  if (leagueError || !league) {
    redirect('/leagues');
  }

  // Fetch events for this league
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('*')
    .eq('league_id', params.leagueId)
    .order('event_date', { ascending: false });

  if (eventsError) {
    console.error('Error fetching events:', eventsError);
    redirect('/leagues');
  }

  // Get participant count for each event
  const eventsWithParticipantCount = await Promise.all(
    (events || []).map(async (event: any) => {
      const { count, error: countError } = await supabase
        .from('event_players')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', event.id);

      return {
        ...event,
        participant_count: count || 0,
      };
    })
  );

  return (
    <EventsContent 
      league={league}
      events={eventsWithParticipantCount}
      isAdmin={isAdmin}
      leagueId={params.leagueId}
    />
  );
}
