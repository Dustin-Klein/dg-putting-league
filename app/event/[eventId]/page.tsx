import { EventHeader, PlayerManagement } from './components';
import { getEventWithPlayers } from '@/lib/event';
import { requireLeagueAdmin } from '@/lib/league-auth';

export default async function EventPage({
  params,
}: {
  params: { eventId: string } | Promise<{ eventId: string }>;
}) {
  const { eventId } = await Promise.resolve(params);

  const event = await getEventWithPlayers(eventId);

  const { isAdmin } = await requireLeagueAdmin(event.league_id);

  return (
    <div className="container mx-auto px-4 py-8">
      <EventHeader event={event} />
      <div className="mt-8">
        <PlayerManagement event={event} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
