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
import { cn } from '@/lib/utils/utils';

export interface EventColumn<T> {
  header: string;
  align?: 'right';
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
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="text-muted-foreground">{emptyMessage}</p>
        </section>
      );
    }
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">{title}</h2>

      <div className="rounded-2xl border bg-card overflow-hidden">
        <Table className="min-w-[560px] text-[15px]">
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.header}
                  className={cn('px-2 first:pl-5 last:pr-5', column.align === 'right' && 'text-right')}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.eventId}>
                {columns.map((column) => (
                  <TableCell
                    key={column.header}
                    className={cn('px-2 py-3 first:pl-5 last:pr-5', column.align === 'right' && 'text-right')}
                  >
                    {column.cell(event)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
