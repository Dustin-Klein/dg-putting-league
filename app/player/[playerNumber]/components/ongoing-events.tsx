'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
      return status;
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

export function OngoingEvents({ ongoingEvents }: OngoingEventsProps) {
  if (ongoingEvents.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Ongoing Events</h2>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pool</TableHead>
              <TableHead>Teammate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ongoingEvents.map((event) => (
              <TableRow key={event.eventId}>
                <TableCell>
                  <Link
                    href={`/event/${event.eventId}/bracket`}
                    className="hover:underline"
                  >
                    {format(new Date(event.eventDate), 'MMM d, yyyy')}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <Link
                      href={`/event/${event.eventId}/bracket`}
                      className="hover:underline"
                    >
                      {event.leagueName} - {format(new Date(event.eventDate), 'MMM d, yyyy')}
                    </Link>
                    {event.eventLocation && (
                      <span className="text-sm text-muted-foreground">
                        {event.eventLocation}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusVariant(event.eventStatus)}>
                    {getStatusLabel(event.eventStatus)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {event.pool ? (
                    <Badge variant="outline">{event.pool}</Badge>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>{event.teammateName || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
