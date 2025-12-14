import { format } from 'date-fns';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LeagueWithRole } from './types';

interface LeaguesListProps {
  leagues: LeagueWithRole[];
}

export default function LeaguesList({ leagues }: LeaguesListProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end mb-4">
        <Button asChild>
          <Link href="/leagues/new">Create League</Link>
        </Button>
      </div>

      {leagues.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <h3 className="text-lg font-medium">No leagues found</h3>
          <p className="text-muted-foreground mt-2 mb-4">
            You don't have access to any leagues yet.
          </p>
          <Button asChild>
            <Link href="/leagues/new">Create your first league</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {leagues.map((league) => (
            <div key={league.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-lg">{league.name}</h3>
                  {league.city && <p className="text-muted-foreground">{league.city}</p>}
                </div>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {league.role}
                </span>
              </div>
              
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Total Events</p>
                  <p className="font-medium">{league.eventCount}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Active Events</p>
                  <p className="font-medium">{league.activeEventCount}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground">Last Event</p>
                  <p className="font-medium">
                    {league.lastEventDate 
                      ? format(new Date(league.lastEventDate), 'MMM d, yyyy')
                      : 'No events yet'}
                  </p>
                </div>
              </div>
              
              <div className="mt-4 flex space-x-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/leagues/${league.id}`}>View Details</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/leagues/${league.id}/events`}>View Events</Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
