'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { EventForm, type EventFormValues } from './event-form';

interface CreateEventDialogProps {
  leagueId: string;
}

export function CreateEventDialog({ leagueId }: CreateEventDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleSubmit = async (values: EventFormValues) => {
    setIsLoading(true);

    try {
      const response = await fetch(`/api/league/${leagueId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_date: values.event_date.toISOString().split('T')[0],
          location: values.location || null,
          lane_count: values.lane_count,
          putt_distance_ft: values.putt_distance_ft,
          access_code: values.access_code,
        }),
      });

      const data = await response.json().catch(() => ({}));
      
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to create event');
      }

      if (!data?.id) {
        throw new Error('Missing event ID in response');
      }
      
      toast({
        title: 'Success',
        description: 'Event created successfully',
      });

      setOpen(false);
      router.refresh();
      
      return data;
    } catch (error) {
      console.error('Error creating event:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create event',
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Create Event</Button>
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
            />
          </div>
        </div>
      )}
    </>
  );
}
