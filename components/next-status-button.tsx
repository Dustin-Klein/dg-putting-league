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
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { EventWithDetails } from '@/lib/types/event';
import { TeamPreviewDialog } from '@/components/team-preview-dialog';

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

interface TeamPreviewData {
  poolAssignments: Array<{
    eventPlayerId: string;
    playerId: string;
    playerName: string;
    pool: 'A' | 'B';
    pfaScore: number;
    scoringMethod: 'qualification' | 'pfa' | 'default';
    defaultPool: 'A' | 'B';
  }>;
  teamPairings: Array<{
    seed: number;
    poolCombo: string;
    combinedScore: number;
    members: Array<{ eventPlayerId: string; role: 'A_pool' | 'B_pool' }>;
  }>;
}

export function NextStatusButton({ event, onStatusUpdate }: NextStatusButtonProps) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);

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

      onStatusUpdate?.();
      setIsDialogOpen(false);
    } catch (error) {
      console.error('Error updating status:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update event status',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleStartBracket = async (previewData: TeamPreviewData) => {
    try {
      setIsUpdating(true);

      const response = await fetch(`/api/event/${event.id}/start-bracket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          poolAssignments: previewData.poolAssignments,
          teamPairings: previewData.teamPairings,
        }),
      });

      if (!response.ok) {
        let message = 'Failed to start bracket';
        try {
          const errorData = await response.json();
          message = errorData?.error || message;
        } catch {
          message = response.statusText || message;
        }
        throw new Error(message);
      }

      onStatusUpdate?.();
      setIsPreviewDialogOpen(false);
    } catch (error) {
      console.error('Error starting bracket:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start bracket',
        variant: 'destructive',
      });
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

  const handleButtonClick = () => {
    if (currentStatus === 'pre-bracket') {
      setIsPreviewDialogOpen(true);
    } else {
      setIsDialogOpen(true);
    }
  };

  const handlePreviewConfirm = async (data: TeamPreviewData) => {
    await handleStartBracket(data);
  };

  return (
    <>
      <Button
        disabled={isDisabled}
        variant={currentStatus === 'completed' ? 'secondary' : 'default'}
        onClick={handleButtonClick}
      >
        {buttonText}
      </Button>

      {/* Simple confirmation dialog for non-bracket transitions */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
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
              onClick={() => handleStatusChange()}
              disabled={isUpdating}
            >
              {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {buttonText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Team preview dialog for pre-bracket to bracket transition */}
      <TeamPreviewDialog
        event={event}
        open={isPreviewDialogOpen}
        onOpenChange={setIsPreviewDialogOpen}
        onConfirm={handlePreviewConfirm}
      />
    </>
  );
}
