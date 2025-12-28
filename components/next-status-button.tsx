'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { EventWithDetails } from '@/app/event/[eventId]/types';

const statusLabelMap = {
  'created': 'Created',
  'pre-bracket': 'Pre-Bracket',
  'bracket': 'Bracket',
  'completed': 'Completed',
} as const;

const nextStatusMap = {
  'created': 'pre-bracket',
  'pre-bracket': 'bracket',
  'bracket': 'completed',
  'completed': null,
} as const;

const nextStatusLabels = {
  'created': 'Open Event',
  'pre-bracket': 'Start Bracket Play',
  'bracket': 'Complete Event',
  'completed': 'Event Completed',
} as const;

interface NextStatusButtonProps {
  event: EventWithDetails;
  onStatusUpdate?: () => void;
}

export function NextStatusButton({ event, onStatusUpdate }: NextStatusButtonProps) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const currentStatus = event.status;
  const nextStatus = nextStatusMap[currentStatus];
  const isDisabled = currentStatus === 'completed' || !nextStatus;
  const buttonText = nextStatusLabels[currentStatus];

  const handleStatusChange = async () => {
    if (!nextStatus) return;

    try {
      setIsUpdating(true);
      
      const response = await fetch(`/api/event/${event.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!response.ok) {
        let message = 'Failed to update status';
        try {
          const errorData = await response.json();
          message = errorData?.error || message;
        } catch {
          message = response.statusText || message;
        }
        throw new Error(message);
      }

      toast({
        title: 'Success',
        description: `Event status updated to ${statusLabelMap[nextStatus]}`,
      });

      onStatusUpdate?.();
      setIsDialogOpen(false);
    } catch (error) {
      console.error('Error updating status:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update event status',
        variant: 'destructive',
      } as any);
    } finally {
      setIsUpdating(false);
    }
  };

  const getConfirmationMessage = () => {
    switch (currentStatus) {
      case 'created':
        return 'This will start the pre-bracket phase of the event. Players will be able to be added to the event and participate in qualifying rounds if enabled.';
      case 'pre-bracket':
        if (event.qualification_round_enabled) {
          return 'This will start the bracket phase. All players must have completed their qualifying rounds to continue.';
        }
        return 'This will start the bracket phase. All players must be marked as paid to continue.';
      case 'bracket':
        return 'This will complete the event and finalize all results. This action cannot be undone.';
      default:
        return '';
    }
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button
          disabled={isDisabled}
          variant={currentStatus === 'completed' ? 'secondary' : 'default'}
        >
          {buttonText}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Status Change</DialogTitle>
          <DialogDescription>
            {getConfirmationMessage()}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setIsDialogOpen(false)}
            disabled={isUpdating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleStatusChange}
            disabled={isUpdating}
          >
            {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {buttonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
