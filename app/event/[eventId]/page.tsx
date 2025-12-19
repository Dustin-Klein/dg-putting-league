import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { EventHeader, PlayerManagement } from './components';
import { EventWithDetails } from './types';

export default async function EventPage({ 
  params 
}: { 
  params: { eventId: string } | Promise<{ eventId: string }>
}) {
  const supabase = await createClient();
  // Handle both direct params and Promise<params>
  const resolvedParams = await Promise.resolve(params);
  const { eventId } = resolvedParams;
  
  if (!eventId) {
    console.error('No eventId provided');
    redirect('/leagues');
  }
  
  // Check if user is authenticated
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    redirect('/auth/sign-in');
  }

  // Fetch event details with players
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select(`
      *,
      players:event_players(
        id,
        created_at,
        player:players(
          id,
          full_name,
          nickname,
          email,
          created_at,
          default_pool,
          player_number
        )
      )
    `)
    .eq('id', eventId)
    .single();

  if (eventError || !event) {
    console.error('Error fetching event:', eventError);
    redirect('/leagues');
  }

  // Check if user is an admin of this event's league
  const { data: leagueAdmin, error: adminError } = await supabase
    .from('league_admins')
    .select('*')
    .eq('league_id', event.league_id)
    .eq('user_id', user.id)
    .single();

  if (adminError || !leagueAdmin) {
    redirect('/leagues');
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <EventHeader event={event as unknown as EventWithDetails} />
      <div className="mt-8">
        <PlayerManagement 
          event={event as unknown as EventWithDetails} 
          isAdmin={!!leagueAdmin} 
        />
      </div>
    </div>
  );
}
