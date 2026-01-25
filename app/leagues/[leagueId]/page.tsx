import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicLeagueWithEvents } from '@/lib/services/league/league-service';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function PublicLeaguePage({
  params: paramsPromise,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const params = await paramsPromise;

  let league;
  try {
    league = await getPublicLeagueWithEvents(params.leagueId);
  } catch {
    notFound();
  }

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'bracket':
        return 'bg-blue-100 text-blue-800';
      case 'pre-bracket':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pre-bracket':
        return 'Pre-Bracket';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <Link
        href="/leagues"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="w-4 h-4 mr-1" />
        All Leagues
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">{league.name}</h1>
        {league.description && (
          <p className="text-muted-foreground mt-2">{league.description}</p>
        )}
      </div>

      <h2 className="text-xl font-semibold mb-4">Events</h2>

      {league.events.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <h3 className="text-lg font-medium">No events scheduled</h3>
          <p className="text-muted-foreground mt-2">
            Check back later for upcoming events.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {league.events.map((event) => {
            const hasBracket = event.status === 'bracket' || event.status === 'completed';

            const cardContent = (
              <Card className={`${hasBracket ? 'hover:shadow-md transition-shadow hover:border-primary cursor-pointer' : ''} h-full`}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">
                      {formatDisplayDate(event.event_date)}
                    </CardTitle>
                    <Badge className={getStatusBadgeStyle(event.status)}>
                      {getStatusLabel(event.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {event.location && (
                    <p className="text-muted-foreground mb-2">{event.location}</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {event.participant_count} {event.participant_count === 1 ? 'participant' : 'participants'}
                  </p>
                  {hasBracket && (
                    <p className="text-sm text-primary mt-2">
                      View Bracket &rarr;
                    </p>
                  )}
                </CardContent>
              </Card>
            );

            if (hasBracket) {
              return (
                <Link key={event.id} href={`/event/${event.id}/bracket`}>
                  {cardContent}
                </Link>
              );
            }

            return <div key={event.id}>{cardContent}</div>;
          })}
        </div>
      )}
    </div>
  );
}
