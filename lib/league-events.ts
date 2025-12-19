import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  UnauthorizedError,
  ForbiddenError,
  InternalError,
} from '@/lib/errors';

export async function getLeagueEventsWithParticipantCounts(
  leagueId: string
) {
  const supabase = await createClient();

  // Auth check
  const { data: { user }, error: userError } =
    await supabase.auth.getUser();

  if (userError || !user) {
    throw new UnauthorizedError();
  }

  // Authorization check
  const { data: leagueAdmin, error: adminError } = await supabase
    .from('league_admins')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (adminError || !leagueAdmin) {
    throw new ForbiddenError(
      'User is not an admin of this league'
    );
  }

  // Fetch events
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('*')
    .eq('league_id', leagueId)
    .order('event_date', { ascending: false });

  if (eventsError) {
    console.error(eventsError);
    throw new InternalError('Failed to fetch events');
  }

  // Participant counts
  const eventsWithParticipantCount = await Promise.all(
    (events ?? []).map(async (event) => {
      const { count } = await supabase
        .from('event_players')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', event.id);

      return {
        ...event,
        participant_count: count ?? 0,
      };
    })
  );

  return eventsWithParticipantCount;
}
