'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatDisplayDate } from '@/lib/utils/date-utils';
import { Button } from '@/components/ui/button';
import type { EventData } from '@/lib/repositories/event-repository.db';
import { CreateEventDialog } from './create-event-dialog';
import { Trash2 } from 'lucide-react';
import { EventStatusBadge, StatusBadge } from '@/components/status-badge';
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
        variant: 'destructive',
      });
    } finally {
      setDeletingEventId(null);
    }
  };

  if (!events || events.length === 0) {
    return (
      <div className="text-center py-12 border-2 border-dashed rounded-2xl">
        <h3 className="text-lg font-medium">No events scheduled yet</h3>
        <p className="text-muted-foreground mt-2 mb-4">
          This league doesn&apos;t have any events yet. {isAdmin && 'Create one to get started.'}
        </p>
        {isAdmin && <CreateEventDialog leagueId={leagueId} completedEvents={[]} />}
      </div>
    );
  }

  return (
    <section aria-labelledby="events-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="events-heading" className="text-xl font-bold">Events</h2>
        {isAdmin && (
          <CreateEventDialog
            leagueId={leagueId}
            completedEvents={(events ?? []).filter(e => e.status === 'completed')}
          />
        )}
      </div>
      {events.map((event) => (
        <article
          key={event.id}
          className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border bg-card px-5 py-[18px]"
        >
          <div className="flex min-w-[200px] flex-[1_1_220px] flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                href={`/admin/event/${event.id}`}
                className="font-score text-2xl leading-none font-bold hover:underline"
              >
                {formatDisplayDate(event.event_date)}
              </Link>
              <EventStatusBadge status={event.status} />
              {event.qualification_round_enabled && (
                <StatusBadge tone="outline">Qualification Round</StatusBadge>
              )}
            </div>
            {event.location && (
              <span className="text-sm text-muted-foreground">{event.location}</span>
            )}
          </div>
          <div className="flex gap-6">
            <EventStat value={event.participant_count || 0} label="Participants" />
            <EventStat value={event.lane_count} label="Lanes" />
            <EventStat value={`${event.putt_distance_ft} ft`} label="Distance" />
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" asChild>
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
        </article>
      ))}
    </section>
  );
}

function EventStat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-score text-[22px] leading-none font-bold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
