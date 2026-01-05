import { redirect } from 'next/navigation';
import { EventsContent } from './events-content';
import { getEventsByLeagueId } from '@/lib/services/event';
import { getLeague } from '@/lib/services/league';
import { requireLeagueAdmin } from '@/lib/services/auth';

export const dynamic = 'force-dynamic';

export default async function LeagueEventsPage({
  params: paramsPromise
}: {
  params: Promise<{ leagueId: string }> | { leagueId: string }
}) {
  const params = await Promise.resolve(paramsPromise);
  const leagueId = params.leagueId;

  const { isAdmin } = await requireLeagueAdmin(leagueId);

  let league = null
  try {
    league = await getLeague(leagueId);
  } catch {
    redirect('/leagues');
  } 
  if (!league) {
      redirect('/leagues');
  }

  const eventsWithParticipantCount = await getEventsByLeagueId(leagueId)

  return (
    <EventsContent 
      league={league}
      events={eventsWithParticipantCount}
      isAdmin={isAdmin}
      leagueId={params.leagueId}
    />
  );
}
