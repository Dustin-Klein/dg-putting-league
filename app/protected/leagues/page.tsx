import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LeagueWithRole } from './types';
import { CreateLeagueDialog } from './components/create-league-dialog';

export default async function LeaguesPage() {
  const supabase = createClient();

  // Check if user is authenticated
  const { data: { user }, error: userError } = await (await supabase).auth.getUser();
  
  if (userError || !user) {
    redirect('/auth/sign-in');
  }

  try {
    // First, get the user's admin records
    const { data: userAdmins, error: adminError } = await (await supabase)
      .from('league_admins')
      .select('*')
      .eq('user_id', user.id);

    if (adminError) {
      throw adminError;
    }

    // If user is not an admin of any leagues, show empty state
    if (!userAdmins || userAdmins.length === 0) {
      return (
        <div className="container mx-auto p-4">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold">My Leagues</h1>
            <CreateLeagueDialog />
          </div>
          <div className="text-center py-12 border-2 border-dashed rounded-lg">
            <p className="text-gray-600 mb-4">You are not an admin of any leagues yet.</p>
            <CreateLeagueDialog />
          </div>
        </div>
      );
    }

    // Get all leagues where user is an admin
    const leagueIds = userAdmins.map(admin => admin.league_id);
    
    // Get the full league data
    const { data: leagues, error: leaguesError } = await (await supabase)
      .from('leagues')
      .select('*')
      .in('id', leagueIds);

    if (leaguesError) {
      throw leaguesError;
    }

    // Combine admin data with league data
    const leagueAdminsWithLeagues = userAdmins
      .map(admin => {
        const league = leagues?.find(l => l.id === admin.league_id);
        return league ? { ...admin, league } : null;
      })
      .filter(Boolean);
      
    if (leagueAdminsWithLeagues.length === 0) {
      return (
        <div className="container mx-auto p-4">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold">My Leagues</h1>
            <CreateLeagueDialog />
          </div>
          <div className="text-center py-12 border-2 border-dashed rounded-lg">
            <p className="text-gray-600 mb-4">No leagues found.</p>
          </div>
        </div>
      );
    }

    // Initialize default values for the API calls
    let eventCounts: Array<{ league_id: string, count: number }> = [];
    let activeEventCounts: Array<{ league_id: string, count: number }> = [];
    let lastEvents: Array<{ league_id: string, event_date: string }> = [];

    try {
      // Get event counts for each league using raw SQL
      const { data: eventCountsData } = await (await supabase).rpc('get_league_event_counts', {
        league_ids: leagueIds
      });
      eventCounts = eventCountsData || [];

      // Get active event counts for each league using raw SQL
      const { data: activeEventCountsData } = await (await supabase).rpc('get_league_active_event_counts', {
        league_ids: leagueIds,
        status_filter: 'completed'
      });
      activeEventCounts = activeEventCountsData || [];

      // Get most recent event date for each league
      const { data: lastEventsData } = await (await supabase)
        .from('events')
        .select('league_id, event_date')
        .in('league_id', leagueIds)
        .order('event_date', { ascending: false });
      lastEvents = lastEventsData || [];
    } catch (error) {
      console.error('Error fetching league statistics:', error);
      // Continue with empty arrays if there's an error
    }

    // Combine all the data
    const formattedLeagues = leagueAdminsWithLeagues
      .map(adminWithLeague => {
        try {
          if (!adminWithLeague || !adminWithLeague.league) {
            console.warn('Skipping invalid league data:', adminWithLeague);
            return null;
          }
          
          const { league, ...admin } = adminWithLeague;
          const eventCount = eventCounts?.find((ec) => ec.league_id === league.id)?.count || 0;
          const activeEventCount = activeEventCounts?.find((aec) => aec.league_id === league.id)?.count || 0;
          const lastEvent = lastEvents?.find((le) => le.league_id === league.id)?.event_date || null;

          return {
            id: league.id,
            name: league.name || 'Unnamed League',
            city: league.city || '',
            created_at: league.created_at || new Date().toISOString(),
            role: admin.role,
            eventCount,
            activeEventCount,
            lastEventDate: lastEvent
          } as LeagueWithRole;
        } catch (error) {
          console.error('Error processing league admin:', admin, error);
          return null;
        }
      })
      .filter((league): league is LeagueWithRole => league !== null);

    return (
      <div className="container mx-auto p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-4">My Leagues</h1>
          <div className="grid gap-4">
            {formattedLeagues.map((league) => (
              <div key={league.id} className="border rounded-lg p-4">
                <h2 className="text-xl font-semibold">{league.name}</h2>
                <p className="text-gray-600">{league.city}</p>
                <div className="mt-2 text-sm text-gray-500">
                  <p>Role: {league.role}</p>
                  <p>Total Events: {league.eventCount}</p>
                  <p>Active Events: {league.activeEventCount}</p>
                  {league.lastEventDate && (
                    <p>Last Event: {new Date(league.lastEventDate).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-6">
          <CreateLeagueDialog />
        </div>
      </div>
    );
  } catch (error) {
    console.error('Error loading leagues:', error);
    return (
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">My Leagues</h1>
          <CreateLeagueDialog />
        </div>
        <div className="text-red-500">Error loading leagues. Please try again later.</div>
      </div>
    );
  }
}
