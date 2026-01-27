'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ReactNode } from 'react';

export interface EventColumn<T> {
  header: string;
  cell: (event: T) => ReactNode;
}

interface EventsTableProps<T extends { eventId: string }> {
  title: string;
  events: T[];
  columns: EventColumn<T>[];
  emptyMessage?: string;
}

export function EventsTable<T extends { eventId: string }>({
  title,
  events,
  columns,
  emptyMessage,
}: EventsTableProps<T>) {
  if (events.length === 0) {
    if (emptyMessage) {
      return (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-muted-foreground">{emptyMessage}</p>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{title}</h2>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.header}>{column.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.eventId}>
                {columns.map((column) => (
                  <TableCell key={column.header}>{column.cell(event)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
