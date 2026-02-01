'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { Button } from '@/components/ui/button';
import { EventData } from '@/lib/repositories/event-repository';
import { CreateEventDialog } from './create-event-dialog';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

type EventWithParticipantCount = EventData & { participant_count: number };

interface EventsListProps {
  events: EventWithParticipantCount[] | null;
  leagueId: string;
  isAdmin?: boolean;
}

export function EventsList({ events = [], leagueId, isAdmin = false }: EventsListProps) {
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Are you sure you want to delete this event? This action cannot be undone.')) {
      return;
    }

    setDeletingEventId(eventId);
    
    try {
      const response = await fetch(`/api/event/${eventId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete event');
      }

      toast({
        title: 'Success',
        description: 'Event deleted successfully',
      });

      // Refresh the page to update the list
      window.location.reload();
    } catch (error) {
      console.error('Error deleting event:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete event',
      });
    } finally {
      setDeletingEventId(null);
    }
  };

  if (!events || events.length === 0) {
    return (
      <div className="text-center py-12 border-2 border-dashed rounded-lg">
        <h3 className="text-lg font-medium">No events scheduled yet</h3>
        <p className="text-muted-foreground mt-2 mb-4">
          This league doesn&apos;t have any events yet. {isAdmin && 'Create one to get started.'}
        </p>
        {isAdmin && <CreateEventDialog leagueId={leagueId} completedEvents={[]} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <CreateEventDialog
            leagueId={leagueId}
            completedEvents={(events ?? []).filter(e => e.status === 'completed')}
          />
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
                  {formatDisplayDate(event.event_date)}
                </h3>
                {event.location && (
                  <p className="text-muted-foreground">{event.location}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  event.status === 'completed' 
                    ? 'bg-green-100 text-green-800' 
                    : event.status === 'created' 
                      ? 'bg-blue-100 text-blue-800' 
                      : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {event.status === 'pre-bracket' ? 'Pre-Bracket' : event.status.charAt(0).toUpperCase() + event.status.slice(1)}
                </span>
                {event.qualification_round_enabled && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                    Qualification Round
                  </span>
                )}
              </div>
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
            
            <div className="mt-4 flex justify-between items-center">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/admin/event/${event.id}`}>
                  View Details
                </Link>
              </Button>
              {isAdmin && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => handleDeleteEvent(event.id)}
                  disabled={deletingEventId === event.id}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Delete event</span>
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
