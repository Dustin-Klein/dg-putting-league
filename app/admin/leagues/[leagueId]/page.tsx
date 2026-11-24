import { redirect } from 'next/navigation';
import { EventsContent } from './components/events-content';
import { getEventsByLeagueId } from '@/lib/services/event';
import { getLeague, checkIsLeagueOwner } from '@/lib/services/league';
import { requireLeagueAdmin } from '@/lib/services/auth';
import { getHandicapSettings } from '@/lib/services/handicap';

export const dynamic = 'force-dynamic';

export default async function LeagueEventsPage({
  params: paramsPromise,
  searchParams,
}: {
  params: Promise<{ leagueId: string }> | { leagueId: string }
  searchParams: Promise<{ tab?: string | string[] }>
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

  const [eventsWithParticipantCount, isOwner, handicapConfig] = await Promise.all([
    getEventsByLeagueId(leagueId),
    checkIsLeagueOwner(leagueId),
    getHandicapSettings(leagueId),
  ]);

  return (
    <EventsContent
      league={league}
      events={eventsWithParticipantCount}
      isAdmin={isAdmin}
      isOwner={isOwner}
      handicap={{ leagueHandicaps: handicapConfig.settings.enabled, zones: handicapConfig.zones }}
      leagueId={params.leagueId}
      initialTab={initialTab((await searchParams).tab, isAdmin, isOwner)}
    />
  );
}

function initialTab(tab: string | string[] | undefined, isAdmin: boolean, isOwner: boolean) {
  if (tab === 'handicaps' && isAdmin) return 'handicaps';
  if (tab === 'admins' && isOwner) return 'admins';
  return 'events';
}
