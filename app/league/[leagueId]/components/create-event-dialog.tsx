'use client';

import { useState } from 'react';
import { formatForDatabase } from '@/lib/utils/date-utils';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EventForm, type EventFormValues } from './event-form';

interface CreateEventDialogProps {
  leagueId: string;
}

export function CreateEventDialog({ leagueId }: CreateEventDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          bracket_frame_count: values.bracket_frame_count,
          qualification_frame_count: values.qualification_frame_count,
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
      router.push(`/event/${data.id}`);

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
      }}>Create Event</Button>
      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background p-6 rounded-lg w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Create New Event</h2>
            <p className="text-muted-foreground mb-6">
              Fill in the details below to create a new event for this league.
            </p>

            <EventForm
              onSubmit={handleSubmit}
              onCancel={() => setOpen(false)}
              isLoading={isLoading}
              submitButtonText="Create Event"
              error={error}
            />
          </div>
        </div>
      )}
    </>
  );
}
