import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

type League = {
  id: string;
  name: string;
  city: string | null;
  created_at: string;
  eventCount: number;
  activeEventCount: number;
  lastEventDate: string | null;
  role: 'owner' | 'admin' | 'scorer';
};

interface LeaguesListProps {
  leagues: League[];
}

export default function LeaguesList({ leagues }: LeaguesListProps) {
  return (
    <div className="space-y-4">
      {leagues.length === 0 ? (
        <div className="text-center py-12">
          <h3 className="text-lg font-medium">No leagues found</h3>
          <p className="text-muted-foreground mt-2 mb-4">
            You don't have any leagues yet. Create your first league to get started.
          </p>
          <Button asChild>
            <Link href="/leagues/new">Create League</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {leagues.map((league) => (
            <Card key={league.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle>{league.name}</CardTitle>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    league.role === 'owner' 
                      ? 'bg-blue-100 text-blue-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {league.role}
                  </span>
                </div>
                {league.city && (
                  <CardDescription>{league.city}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Events</p>
                    <p className="font-semibold">{league.eventCount}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Active Events</p>
                    <p className="font-semibold">{league.activeEventCount}</p>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex justify-between">
                <Button variant="outline" asChild>
                  <Link href={`/leagues/${league.id}`}>View Details</Link>
                </Button>
                <Button asChild>
                  <Link href={`/leagues/${league.id}/events`}>View Events</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      
      {leagues.length > 0 && (
        <div className="mt-8">
          <Button asChild>
            <Link href="/leagues/new">Create New League</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
