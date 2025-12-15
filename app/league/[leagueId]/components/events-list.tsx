'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Event } from '../types';
import { CreateEventDialog } from './create-event-dialog';

interface EventsListProps {
  events: Event[] | null;
  leagueId: string;
  isAdmin?: boolean;
}

export function EventsList({ events = [], leagueId, isAdmin = false }: EventsListProps) {
  if (!events || events.length === 0) {
    return (
      <div className="text-center py-12 border-2 border-dashed rounded-lg">
        <h3 className="text-lg font-medium">No events scheduled yet</h3>
        <p className="text-muted-foreground mt-2 mb-4">
          This league doesn't have any events yet. {isAdmin && 'Create one to get started.'}
        </p>
        {isAdmin && <CreateEventDialog leagueId={leagueId} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <CreateEventDialog leagueId={leagueId} />
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {events.map((event) => (
          <div 
            key={event.id} 
            className="border rounded-lg p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-lg">
                  {format(new Date(event.event_date), 'MMMM d, yyyy')}
                </h3>
                {event.location && (
                  <p className="text-muted-foreground">{event.location}</p>
                )}
              </div>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                event.status === 'completed' 
                  ? 'bg-green-100 text-green-800' 
                  : event.status === 'registration' 
                    ? 'bg-blue-100 text-blue-800' 
                    : 'bg-yellow-100 text-yellow-800'
              }`}>
                {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
              </span>
            </div>
            
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Lanes</p>
                <p className="font-medium">{event.lane_count}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Distance</p>
                <p className="font-medium">{event.putt_distance_ft} ft</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground">Participants</p>
                <p className="font-medium">
                  {event.participant_count || 0} registered
                </p>
              </div>
            </div>
            
            <div className="mt-4 flex justify-end">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/leagues/${leagueId}/events/${event.id}`}>
                  View Details
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
