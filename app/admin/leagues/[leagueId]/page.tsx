import { redirect } from 'next/navigation';
import { EventsContent } from './events-content';
import { getEventsByLeagueId } from '@/lib/services/event';
import { getLeague, checkIsLeagueOwner } from '@/lib/services/league';
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
    redirect('/admin/leagues');
  } 
  if (!league) {
      redirect('/admin/leagues');
  }

  const [eventsWithParticipantCount, isOwner] = await Promise.all([
    getEventsByLeagueId(leagueId),
    checkIsLeagueOwner(leagueId),
  ]);

  return (
    <EventsContent
      league={league}
      events={eventsWithParticipantCount}
      isAdmin={isAdmin}
      isOwner={isOwner}
      leagueId={params.leagueId}
    />
  );
}
