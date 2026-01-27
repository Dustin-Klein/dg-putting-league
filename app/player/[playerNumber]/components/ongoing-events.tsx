'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { EventsTable, type EventColumn } from './events-table';
import type { PlayerOngoingEvent } from '@/lib/types/player-statistics';

interface OngoingEventsProps {
  ongoingEvents: PlayerOngoingEvent[];
}

function getStatusLabel(status: PlayerOngoingEvent['eventStatus']): string {
  switch (status) {
    case 'created':
      return 'Upcoming';
    case 'pre-bracket':
      return 'Registration';
    case 'bracket':
      return 'In Progress';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function getStatusVariant(
  status: PlayerOngoingEvent['eventStatus']
): 'default' | 'secondary' | 'outline' {
  switch (status) {
    case 'bracket':
      return 'default';
    case 'pre-bracket':
      return 'secondary';
    default:
      return 'outline';
  }
}

const columns: EventColumn<PlayerOngoingEvent>[] = [
  {
    header: 'Date',
    cell: (event) => (
      <Link
        href={`/event/${event.eventId}/bracket`}
        className="hover:underline"
      >
        {format(new Date(event.eventDate), 'MMM d, yyyy')}
      </Link>
    ),
  },
  {
    header: 'Event',
    cell: (event) => (
      <div className="flex flex-col">
        <Link
          href={`/event/${event.eventId}/bracket`}
          className="hover:underline"
        >
          {event.leagueName}
        </Link>
        {event.eventLocation && (
          <span className="text-sm text-muted-foreground">
            {event.eventLocation}
          </span>
        )}
      </div>
    ),
  },
  {
    header: 'Status',
    cell: (event) => (
      <Badge variant={getStatusVariant(event.eventStatus)}>
        {getStatusLabel(event.eventStatus)}
      </Badge>
    ),
  },
  {
    header: 'Pool',
    cell: (event) =>
      event.pool ? <Badge variant="outline">{event.pool}</Badge> : '-',
  },
  {
    header: 'Teammate',
    cell: (event) => event.teammateName || '-',
  },
];

export function OngoingEvents({ ongoingEvents }: OngoingEventsProps) {
  return (
    <EventsTable
      title="Ongoing Events"
      events={ongoingEvents}
      columns={columns}
    />
  );
}
