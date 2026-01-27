'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { formatPlacement } from '@/lib/utils/format-utils';
import { EventsTable, type EventColumn } from './events-table';
import type { PlayerEventHistory } from '@/lib/types/player-statistics';

interface EventHistoryProps {
  eventHistory: PlayerEventHistory[];
}

function getPlacementVariant(
  place: number | null
): 'default' | 'secondary' | 'outline' {
  if (place === 1) return 'default';
  if (place !== null && place <= 3) return 'secondary';
  return 'outline';
}

const columns: EventColumn<PlayerEventHistory>[] = [
  {
    header: 'Date',
    cell: (event) => (
      <Link
        href={`/event/${event.eventId}/bracket`}
        className="hover:underline"
      >
        <time dateTime={event.eventDate}>
          {format(new Date(event.eventDate), 'MMM d, yyyy')}
        </time>
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
          {event.leagueName} -{' '}
          <time dateTime={event.eventDate}>
            {format(new Date(event.eventDate), 'MMM d, yyyy')}
          </time>
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
    header: 'Pool',
    cell: (event) =>
      event.pool ? <Badge variant="outline">{event.pool}</Badge> : '-',
  },
  {
    header: 'Teammate',
    cell: (event) => event.teammateName || '-',
  },
  {
    header: 'Record',
    cell: (event) =>
      event.wins > 0 || event.losses > 0 ? (
        <span>
          {event.wins}W - {event.losses}L
        </span>
      ) : (
        '-'
      ),
  },
  {
    header: 'Place',
    cell: (event) =>
      event.placement !== null ? (
        <Badge variant={getPlacementVariant(event.placement)}>
          {formatPlacement(event.placement)}
        </Badge>
      ) : (
        '-'
      ),
  },
];

export function EventHistory({ eventHistory }: EventHistoryProps) {
  return (
    <EventsTable
      title="Event History"
      events={eventHistory}
      columns={columns}
      emptyMessage="No events played yet."
    />
  );
}
