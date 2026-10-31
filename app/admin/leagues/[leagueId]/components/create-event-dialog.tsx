'use client';

import { useState } from 'react';
import { formatForDatabase, formatDisplayDate } from '@/lib/utils/date-utils';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EventForm, type EventFormValues } from './event-form';
import type { EventData } from '@/lib/repositories/event-repository.db';

interface CreateEventDialogProps {
  leagueId: string;
  leagueName?: string;
  completedEvents?: EventData[];
}

export function CreateEventDialog({ leagueId, leagueName, completedEvents = [] }: CreateEventDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFromEventId, setCopyFromEventId] = useState<string>('');
  const router = useRouter();

  const handleSubmit = async (values: EventFormValues) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/league/${leagueId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_date: formatForDatabase(values.event_date),
          location: values.location || null,
          lane_count: values.lane_count,
          putt_distance_ft: values.putt_distance_ft,
          access_code: values.access_code,
          qualification_round_enabled: values.qualification_round_enabled,
          double_grand_final: values.double_grand_final,
          bracket_frame_count: values.bracket_frame_count,
          qualification_frame_count: values.qualification_frame_count,
          entry_fee_per_player: values.entry_fee_per_player ?? null,
          admin_fees: values.admin_fees ?? null,
          admin_fee_per_player: values.admin_fee_per_player ?? null,
          team_size: values.team_size,
          team_assignment: values.team_assignment,
          ...(copyFromEventId ? { copy_players_from_event_id: copyFromEventId } : {}),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to create event');
      }

      if (!data?.id) {
        throw new Error('Missing event ID in response');
      }

      setOpen(false);
      router.push(`/admin/event/${data.id}`);

      return data;
    } catch (err) {
      console.error('Error creating event:', err);
      setError(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => {
        setOpen(true);
        setError(null);
        setCopyFromEventId('');
      }}>Create Event</Button>
      <Dialog open={open} onOpenChange={(next) => !isLoading && setOpen(next)}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-[720px]">
          <DialogHeader className="gap-0.5 border-b px-5 py-[22px] pr-14 text-left sm:px-7">
            <DialogTitle className="font-score text-[32px] leading-none">New event</DialogTitle>
            <DialogDescription>
              {leagueName ?? 'Fill in the details below to create a new event for this league.'}
            </DialogDescription>
          </DialogHeader>

            <EventForm
              onSubmit={handleSubmit}
              onCancel={() => setOpen(false)}
              isLoading={isLoading}
              submitButtonText="Create event"
              error={error}
              extraContent={completedEvents.length > 0 ? (
                <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
                  <legend className="pb-3 text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">
                    Players
                  </legend>
                  <label htmlFor="copy-players" className="text-sm font-semibold">
                    Copy players from
                  </label>
                  <select
                    id="copy-players"
                    value={copyFromEventId}
                    onChange={(e) => setCopyFromEventId(e.target.value)}
                    disabled={isLoading}
                    className="h-11 w-full rounded-lg border-[1.5px] border-input bg-control px-3 text-base md:text-[15px]"
                  >
                    <option value="">None</option>
                    {completedEvents.map((event) => (
                      <option key={event.id} value={event.id}>
                        {formatDisplayDate(event.event_date)}
                        {event.location ? ` — ${event.location}` : ''}
                      </option>
                    ))}
                  </select>
                </fieldset>
              ) : undefined}
            />
        </DialogContent>
      </Dialog>
    </>
  );
}
