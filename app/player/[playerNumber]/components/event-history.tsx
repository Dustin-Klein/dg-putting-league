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
import { formatPlacement } from '@/lib/utils';
import type { PlayerEventHistory } from '@/lib/types/player-statistics';

interface EventHistoryProps {
  eventHistory: PlayerEventHistory[];
}

export function EventHistory({ eventHistory }: EventHistoryProps) {
  if (eventHistory.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Event History</h2>
        <p className="text-muted-foreground">No events played yet.</p>
      </div>
    );
  }

  const getPlacementVariant = (place: number | null): "default" | "secondary" | "outline" => {
    if (place === 1) return "default";
    if (place !== null && place <= 3) return "secondary";
    return "outline";
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Event History</h2>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>League</TableHead>
              <TableHead>Pool</TableHead>
              <TableHead>Teammate</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Place</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {eventHistory.map((event) => (
              <TableRow key={event.eventId}>
                <TableCell>
                  <Link
                    href={`/event/${event.eventId}`}
                    className="hover:underline"
                  >
                    {format(new Date(event.eventDate), 'MMM d, yyyy')}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/league/${event.leagueId}`}
                    className="hover:underline"
                  >
                    {event.leagueName}
                  </Link>
                </TableCell>
                <TableCell>
                  {event.pool ? (
                    <Badge variant="outline">{event.pool}</Badge>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>
                  {event.teammateName || '-'}
                </TableCell>
                <TableCell>
                  {event.wins > 0 || event.losses > 0 ? (
                    <span>
                      {event.wins}W - {event.losses}L
                    </span>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>
                  {event.placement !== null ? (
                    <Badge variant={getPlacementVariant(event.placement)}>
                      {formatPlacement(event.placement)}
                    </Badge>
                  ) : (
                    '-'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
