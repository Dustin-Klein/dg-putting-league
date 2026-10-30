'use client';

import Link from 'next/link';
import { PoolBadge } from '@/components/pool-badge';
import { EventStatusBadge } from '@/components/status-badge';
import { EventsTable, type EventColumn } from './events-table';
import { formatShortDate } from '@/lib/utils/date-utils';
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

const columns: EventColumn<PlayerOngoingEvent>[] = [
  {
    header: 'Date',
    cell: (event) => (
      <Link
        href={`/event/${event.eventId}/bracket`}
        className="hover:underline"
      >
        {formatShortDate(event.eventDate)}
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
      <EventStatusBadge status={event.eventStatus} label={getStatusLabel(event.eventStatus)} />
    ),
  },
  {
    header: 'Pool',
    cell: (event) =>
      event.pool ? <PoolBadge pool={event.pool} /> : '-',
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
