"use client";

import { Button } from '@/components/ui/button';
import { EventsList } from './components/events-list';
import { CreateEventDialog } from './components/create-event-dialog';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

interface EventsContentProps {
  league: any;
  events: any[];
  isAdmin: boolean;
  leagueId: string;
}

export function EventsContent({ league, events, isAdmin, leagueId }: EventsContentProps) {
  return (
    <div className="container mx-auto p-4">
      <div className="mb-6">
        <Link 
          href={`/leagues`} 
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to my leagues
        </Link>
        
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold">{league.name}</h1>
            {league.city && (
              <p className="text-muted-foreground">{league.city}</p>
            )}
          </div>
          <CreateEventDialog leagueId={leagueId} />
        </div>

        <EventsList 
          events={events} 
          leagueId={leagueId} 
          isAdmin={isAdmin} 
        />
      </div>
    </div>
  );
}
