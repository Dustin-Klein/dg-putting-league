'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils/utils';
import { PoolBadge } from '@/components/pool-badge';
import { formatPlacement } from '@/lib/utils/format-utils';
import { formatShortDate, parseLocalDate } from '@/lib/utils/date-utils';
import { EventsTable, type EventColumn } from './events-table';
import type { PlayerEventHistory } from '@/lib/types/player-statistics';

interface EventHistoryProps {
  eventHistory: PlayerEventHistory[];
}

const columns: EventColumn<PlayerEventHistory>[] = [
  {
    header: 'Place',
    cell: (event) =>
      event.placement !== null ? (
        <span
          className={cn(
            'inline-flex h-8 w-11 items-center justify-center rounded-lg font-score text-lg font-bold',
            event.placement === 1 ? 'bg-gold/15 text-gold' : 'bg-muted text-foreground'
          )}
        >
          {formatPlacement(event.placement)}
        </span>
      ) : (
        '-'
      ),
  },
  {
    header: 'Date',
    cell: (event) => (
      <Link
        href={`/event/${event.eventId}/bracket`}
        className="hover:underline"
      >
        <time dateTime={event.eventDate}>
          {formatShortDate(event.eventDate)}
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
            {formatShortDate(event.eventDate)}
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
      event.pool ? <PoolBadge pool={event.pool} /> : '-',
  },
  {
    header: 'Teammate',
    cell: (event) => event.teammateName || '-',
  },
  {
    header: 'Record',
    align: 'right',
    cell: (event) =>
      event.wins > 0 || event.losses > 0 ? (
        <span className="font-score text-xl font-bold tabular-nums">
          {event.wins}W - {event.losses}L
        </span>
      ) : (
        '-'
      ),
  },
];

export function EventHistory({ eventHistory }: EventHistoryProps) {
  const sorted = [...eventHistory].sort(
    (a, b) => parseLocalDate(b.eventDate).getTime() - parseLocalDate(a.eventDate).getTime()
  );

  return (
    <EventsTable
      title="Event History"
      events={sorted}
      columns={columns}
      emptyMessage="No events played yet."
    />
  );
}
