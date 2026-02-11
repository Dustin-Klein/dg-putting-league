'use client';

import { useState } from 'react';
import type { Match, Participant } from 'brackets-model';
import type { Team } from '@/lib/types/team';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, X } from 'lucide-react';

interface AdvanceTeamDialogProps {
  match: Match | null;
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdvanceComplete: () => void;
  participants: Participant[];
  participantTeamMap: Record<number, Team>;
}

type Slot = 'opponent1' | 'opponent2';

export function AdvanceTeamDialog({
  match,
  eventId,
  open,
  onOpenChange,
  onAdvanceComplete,
  participants,
  participantTeamMap,
}: AdvanceTeamDialogProps) {
  const [selectedParticipant, setSelectedParticipant] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<Slot | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingSlot, setRemovingSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!match) return null;

  const opp1 = match.opponent1 as { id?: number | null } | null;
  const opp2 = match.opponent2 as { id?: number | null } | null;

  const opp1Empty = !opp1 || opp1.id == null;
  const opp2Empty = !opp2 || opp2.id == null;

  const emptySlots: Slot[] = [];
  if (opp1Empty) emptySlots.push('opponent1');
  if (opp2Empty) emptySlots.push('opponent2');

  const occupiedSlots: { slot: Slot; participantId: number }[] = [];
  if (!opp1Empty) occupiedSlots.push({ slot: 'opponent1', participantId: opp1!.id! });
  if (!opp2Empty) occupiedSlots.push({ slot: 'opponent2', participantId: opp2!.id! });

  const hasEmptySlots = emptySlots.length > 0;

  // Auto-select slot if only one is empty
  const effectiveSlot = emptySlots.length === 1 ? emptySlots[0] : (selectedSlot as Slot);

  const getTeamLabel = (participantId: number): string => {
    const team = participantTeamMap[participantId];
    return team ? `#${team.seed} ${team.pool_combo}` : `Participant ${participantId}`;
  };

  const handleSubmit = async () => {
    if (!selectedParticipant || !effectiveSlot) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/event/${eventId}/bracket/match/${match.id}/advance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participant_id: parseInt(selectedParticipant, 10),
            slot: effectiveSlot,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to advance team');
      }

      setSelectedParticipant('');
      setSelectedSlot('');
      onOpenChange(false);
      onAdvanceComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance team');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (slot: Slot) => {
    setRemovingSlot(slot);
    setError(null);

    try {
      const response = await fetch(
        `/api/event/${eventId}/bracket/match/${match.id}/remove`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to remove team');
      }

      onOpenChange(false);
      onAdvanceComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove team');
    } finally {
      setRemovingSlot(null);
    }
  };

  const slotLabel = (slot: Slot) => slot === 'opponent1' ? 'Top Slot' : 'Bottom Slot';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage Match Teams</DialogTitle>
          <DialogDescription>
            Place a team into an empty slot or remove an existing team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {occupiedSlots.length > 0 && (
            <div className="space-y-2">
              <Label>Current Teams</Label>
              {occupiedSlots.map(({ slot, participantId }) => (
                <div key={slot} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="text-sm">
                    <span className="text-muted-foreground">{slotLabel(slot)}:</span>{' '}
                    <span className="font-medium">{getTeamLabel(participantId)}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(slot)}
                    disabled={removingSlot !== null || isSubmitting}
                  >
                    {removingSlot === slot ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                    <span className="ml-1">Remove</span>
                  </Button>
                </div>
              ))}
            </div>
          )}

          {hasEmptySlots && (
            <>
              {occupiedSlots.length > 0 && <hr />}

              <Label>Advance Team</Label>

              {emptySlots.length > 1 && (
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Slot</Label>
                  <Select value={selectedSlot} onValueChange={(v) => setSelectedSlot(v as Slot)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select slot" />
                    </SelectTrigger>
                    <SelectContent>
                      {emptySlots.map((slot) => (
                        <SelectItem key={slot} value={slot}>
                          {slotLabel(slot)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {emptySlots.length === 1 && (
                <p className="text-sm text-muted-foreground">
                  Placing into: <span className="font-medium">{slotLabel(emptySlots[0])}</span>
                </p>
              )}

              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Team</Label>
                <Select value={selectedParticipant} onValueChange={setSelectedParticipant}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    {participants
                      .filter((p) => participantTeamMap[p.id as number])
                      .map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {getTeamLabel(p.id as number)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!selectedParticipant || !effectiveSlot || isSubmitting || removingSlot !== null}
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Advance Team
                </Button>
              </div>
            </>
          )}

          {!hasEmptySlots && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
