'use client';

import { useState } from 'react';
import type { Match, Participant } from 'brackets-model';
import { Status } from 'brackets-model';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, X, RotateCcw } from 'lucide-react';

interface AdvanceTeamDialogProps {
  match: Match | null;
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdvanceComplete: () => void;
  onEditScores: (match: Match) => void;
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
  onEditScores,
  participants,
  participantTeamMap,
}: AdvanceTeamDialogProps) {
  const [selectedParticipant, setSelectedParticipant] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<Slot | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingSlot, setRemovingSlot] = useState<Slot | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [winnerChangeVerified, setWinnerChangeVerified] = useState(false);
  const [teamsNotified, setTeamsNotified] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!match) return null;

  const isCompletedOrArchived =
    match.status === Status.Completed || match.status === Status.Archived;

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
        const advanceErrorResponse = await response.json();
        throw new Error(advanceErrorResponse.error || 'Failed to advance team');
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
        const removeErrorResponse = await response.json();
        throw new Error(removeErrorResponse.error || 'Failed to remove team');
      }

      onOpenChange(false);
      onAdvanceComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove team');
    } finally {
      setRemovingSlot(null);
    }
  };

  const handleReset = async () => {
    if (!winnerChangeVerified || !teamsNotified || correctionReason.trim().length < 3) {
      setError('Complete verification, notifications, and reason before resetting.');
      return;
    }

    setIsResetting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/event/${eventId}/bracket/match/${match.id}/reset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            correction_reason: correctionReason.trim(),
            winner_change_verified: winnerChangeVerified,
            teams_notified: teamsNotified,
          }),
        }
      );

      if (!response.ok) {
        const resetErrorResponse = await response.json();
        throw new Error(resetErrorResponse.error || 'Failed to reset match');
      }

      setShowResetConfirm(false);
      onOpenChange(false);
      onAdvanceComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset match');
    } finally {
      setIsResetting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setShowResetConfirm(false);
      setWinnerChangeVerified(false);
      setTeamsNotified(false);
      setCorrectionReason('');
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const handleEditScores = () => {
    onOpenChange(false);
    onEditScores(match);
  };

  const slotLabel = (slot: Slot) => slot === 'opponent1' ? 'Top Slot' : 'Bottom Slot';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isCompletedOrArchived ? 'Completed Match Actions' : 'Manage Match Teams'}
          </DialogTitle>
          <DialogDescription>
            {isCompletedOrArchived
              ? 'Choose score correction when the winner stays the same, or reset when winner/progression must change.'
              : 'Place a team into an empty slot or remove an existing team.'}
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
                  {!isCompletedOrArchived && (
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
                  )}
                </div>
              ))}
            </div>
          )}

          {isCompletedOrArchived && (
            <>
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="font-medium">Choose the Right Action</p>
                <ul className="mt-2 list-disc pl-4 text-muted-foreground space-y-1">
                  <li>Use Edit Scores when the score is wrong but the winner does not change.</li>
                  <li>Use Reset Match Result when the corrected score changes the winner or bracket progression. Reset will clear scores for this match and affected downstream matches before re-scoring.</li>
                </ul>
              </div>

              {!showResetConfirm ? (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => handleOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button variant="secondary" onClick={handleEditScores}>
                    Edit Scores
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setShowResetConfirm(true)}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset Match Result
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                    <p className="text-sm font-medium text-destructive">Are you sure?</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      This will reset this match and any downstream matches that were
                      affected by its result. All frame scores for reset matches will be
                      deleted. The match will return to Ready status for re-scoring.
                    </p>
                  </div>
                  <div className="rounded-md border p-3 text-sm space-y-3">
                    <p className="font-medium">Winner-Changing Correction Workflow</p>
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="winner-change-verified"
                          checked={winnerChangeVerified}
                          onCheckedChange={(checked) => setWinnerChangeVerified(checked === true)}
                          disabled={isResetting}
                        />
                        <Label htmlFor="winner-change-verified" className="font-normal leading-5">
                          I verified the corrected winner and impacted downstream matches before reset.
                        </Label>
                      </div>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="teams-notified"
                          checked={teamsNotified}
                          onCheckedChange={(checked) => setTeamsNotified(checked === true)}
                          disabled={isResetting}
                        />
                        <Label htmlFor="teams-notified" className="font-normal leading-5">
                          I notified both teams and relevant staff about the winner-changing correction.
                        </Label>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="correction-reason">Correction Reason</Label>
                      <Textarea
                        id="correction-reason"
                        value={correctionReason}
                        onChange={(e) => setCorrectionReason(e.target.value)}
                        placeholder="What was wrong and why this winner-changing reset is required"
                        disabled={isResetting}
                        maxLength={500}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setShowResetConfirm(false)}
                      disabled={isResetting}
                    >
                      Go Back
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleReset}
                      disabled={
                        isResetting ||
                        !winnerChangeVerified ||
                        !teamsNotified ||
                        correctionReason.trim().length < 3
                      }
                    >
                      {isResetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Confirm Reset
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {!isCompletedOrArchived && hasEmptySlots && (
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
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
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

          {!isCompletedOrArchived && !hasEmptySlots && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
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
