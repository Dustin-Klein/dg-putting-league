"use client";

import { format } from 'date-fns';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LeagueWithRole } from '@/lib/types/league';
import { CreateLeagueDialog } from './create-league-dialog';

interface LeaguesListProps {
  leagues: LeagueWithRole[];
}

export default function LeaguesList({ leagues }: LeaguesListProps) {
  const handleCardClick = (leagueId: string) => {
    window.location.href = `/league/${leagueId}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end mb-4">
        <CreateLeagueDialog />
      </div>

      {leagues.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <h3 className="text-lg font-medium">No leagues found</h3>
          <p className="text-muted-foreground mt-2 mb-4">
            You don't have access to any leagues yet.
          </p>
          <CreateLeagueDialog />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {leagues.map((league) => (
            <div
              key={league.id}
              onClick={() => handleCardClick(league.id)}
              className="border rounded-lg p-4 hover:shadow-md transition-shadow hover:border-primary cursor-pointer"
            >
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

              <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/league/${league.id}`}>View Details</Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
