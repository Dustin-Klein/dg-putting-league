import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EventsList } from './events/components/events-list';
import { CreateEventDialog } from './events/components/create-event-dialog';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export default async function LeaguePage({
  params,
}: {
  params: { leagueId: string };
}) {
  const supabase = await createClient();

  // Check if user is authenticated
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    redirect('/auth/sign-in');
  }

  try {
    // Check if user is an admin of this league
    const { data: leagueAdmin, error: adminError } = await supabase
      .from('league_admins')
      .select('*')
      .eq('league_id', params.leagueId)
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
      throw eventsError;
    }

    // Get participant count for each event
    const eventsWithParticipantCount = await Promise.all(
      (events || []).map(async (event) => {
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
      <div className="container mx-auto p-4">
        <div className="mb-6">
          <Link 
            href="/leagues" 
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back to Leagues
          </Link>
          
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold">{league.name}</h1>
              {league.city && (
                <p className="text-muted-foreground">{league.city}</p>
              )}
            </div>
            <CreateEventDialog leagueId={params.leagueId} />
          </div>

          <EventsList 
            events={eventsWithParticipantCount} 
            leagueId={params.leagueId} 
            isAdmin={isAdmin} 
          />
        </div>
      </div>
    );
  } catch (error) {
    console.error('Error loading league:', error);
    return (
      <div className="container mx-auto p-4">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
          <p className="text-muted-foreground mb-6">
            We couldn't load the league. Please try again later.
          </p>
          <Button asChild>
            <Link href="/leagues">Back to Leagues</Link>
          </Button>
        </div>
      </div>
    );
  }
}
