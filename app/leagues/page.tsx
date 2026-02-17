import Link from 'next/link';
import { getPublicLeagues } from '@/lib/services/league/league-service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function PublicLeaguesPage() {
  const leagues = await getPublicLeagues();

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Leagues</h1>

      {leagues.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <h3 className="text-lg font-medium">No leagues available</h3>
          <p className="text-muted-foreground mt-2">
            Check back later for upcoming leagues.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {leagues.map((league) => (
            <Link key={league.id} href={`/leagues/${league.id}`}>
              <Card className="hover:shadow-md transition-shadow hover:border-primary cursor-pointer h-full">
                <CardHeader>
                  <CardTitle>{league.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {league.event_count} {league.event_count === 1 ? 'event' : 'events'}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
