import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LeagueWithRole } from './types';
import LeaguesList from './LeaguesList';

export default async function LeaguePage() {
  const supabase = await createClient();

  // Check if user is authenticated
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    redirect('/auth/sign-in');
  }

  try {
    // First, get the user's admin records
    const { data: userAdmins, error: adminError } = await supabase
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
          </div>
          <LeaguesList leagues={[]} />
        </div>
      );
    }

    // Get the league details for each admin record
    const { data: leagues, error: leaguesError } = await supabase
      .from('leagues')
      .select('*')
      .in('id', userAdmins.map(admin => admin.league_id));

    if (leaguesError) {
      throw leaguesError;
    }

    // Transform the data to include the role and other details
    const leaguesWithRole: LeagueWithRole[] = await Promise.all(
      leagues.map(async (league) => {
        const adminRecord = userAdmins.find(admin => admin.league_id === league.id);
        const role = adminRecord?.role || 'member';
        
        // Get event counts
        const { count: eventCount } = await supabase
          .from('events')
          .select('*', { count: 'exact', head: true })
          .eq('league_id', league.id)
          .single();

        const { count: activeEventCount } = await supabase
          .from('events')
          .select('*', { count: 'exact', head: true })
          .eq('league_id', league.id)
          .neq('status', 'completed')
          .single();

        // Get most recent event date
        const { data: lastEvent } = await supabase
          .from('events')
          .select('event_date')
          .eq('league_id', league.id)
          .order('event_date', { ascending: false })
          .limit(1)
          .single();

        return {
          ...league,
          role,
          eventCount: eventCount || 0,
          activeEventCount: activeEventCount || 0,
          lastEventDate: lastEvent?.event_date || null
        };
      })
    );

    return (
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">My Leagues</h1>
        </div>
        <LeaguesList leagues={leaguesWithRole} />
      </div>
    );
  } catch (error) {
    console.error('Error loading leagues:', error);
    return (
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">My Leagues</h1>
        </div>
        <div className="text-red-500">Error loading leagues. Please try again later.</div>
      </div>
    );
  }
}
