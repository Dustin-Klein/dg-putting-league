'use client';

import { useState, useEffect, useCallback } from 'react';
import { Eraser, Loader2, Pencil, Shuffle, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { PoolBadge } from '@/components/pool-badge';
import { formatScore, ManualTeamEditor } from '@/components/manual-team-editor';
import { cn } from '@/lib/utils/utils';
import { EventWithDetails } from '@/lib/types/event';
import type { TeamPreview, TeamPreviewPlayer } from '@/lib/types/team';
import {
  describeTeamFormat,
  emptyTeamDraft,
  sortBySlot,
  teamDraftFromPairings,
  teamDraftProblem,
  teamDraftToPairings,
  toStartBracketRequest,
  type StartBracketRequest,
  type TeamDraft,
} from '@/lib/utils/team-utils';

interface TeamPreviewDialogProps {
  event: EventWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (request: StartBracketRequest) => Promise<void>;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const errorData = await response.json();
    return errorData?.error || fallback;
  } catch {
    return response.statusText || fallback;
  }
}

/**
 * Manual drafts live only in the browser until bracket start (plan 07, A6); keep
 * them in sessionStorage so an accidental close or refresh doesn't lose the work.
 */
function draftStorageKey(eventId: string) {
  return `team-draft:${eventId}`;
}

function loadDraft(eventId: string, preview: TeamPreview): TeamDraft | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(draftStorageKey(eventId)) ?? 'null');
    const roster = preview.players.map((p) => p.eventPlayerId).sort().join(',');
    if (stored?.roster !== roster || stored?.teamSize !== preview.teamSize) return null;
    return stored.draft as TeamDraft;
  } catch {
    return null;
  }
}

function saveDraft(eventId: string, preview: TeamPreview, draft: TeamDraft) {
  try {
    const roster = preview.players.map((p) => p.eventPlayerId).sort().join(',');
    sessionStorage.setItem(draftStorageKey(eventId), JSON.stringify({ roster, teamSize: preview.teamSize, draft }));
  } catch {
    // Storage full or disabled: the draft still works, it just won't survive a reload.
  }
}

export function TeamPreviewDialog({
  event,
  open,
  onOpenChange,
  onConfirm,
}: TeamPreviewDialogProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  // The server draw kept while the organizer hand-edits it, so they can go back to it.
  const [drawPreview, setDrawPreview] = useState<TeamPreview | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [previewData, setPreviewData] = useState<TeamPreview | null>(null);
  const [draft, setDraft] = useState<TeamDraft | null>(null);

  const isManual = previewData?.teamAssignment === 'manual';

  const fetchPreview = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/event/${event.id}/team-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(await readError(response, 'Failed to generate team preview'));
      }

      const data: TeamPreview = await response.json();
      setPreviewData(data);
      setDraft(
        data.teamAssignment === 'manual'
          ? loadDraft(event.id, data) ?? emptyTeamDraft(data.players.length, data.teamSize)
          : null
      );
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to generate team preview',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [event.id, toast]);

  useEffect(() => {
    if (open && !previewData) {
      fetchPreview();
    }
  }, [open, previewData, fetchPreview]);

  const updateDraft = (next: TeamDraft) => {
    setDraft(next);
    // A hand-edited draw isn't the event's format until the bracket starts; don't keep it.
    if (previewData && !drawPreview) saveDraft(event.id, previewData, next);
  };

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    await fetchPreview();
    setIsRegenerating(false);
  };

  /**
   * Hand-edit the current draw. Nothing is saved yet: starting the bracket records
   * the event as manually assigned, and cancelling leaves it as it was.
   */
  const handleEditManually = () => {
    if (!previewData) return;
    setDrawPreview(previewData);
    setPreviewData({
      ...previewData,
      teamAssignment: 'manual',
      players: previewData.players.map((player) => ({ ...player, pool: null })),
      teamPairings: [],
    });
    setDraft(teamDraftFromPairings(previewData.teamPairings));
  };

  const handleBackToDraw = () => {
    setPreviewData(drawPreview);
    setDrawPreview(null);
    setDraft(null);
  };

  /** Fill the open slots with the unassigned players in random order. */
  const handleFillRandomly = () => {
    if (!previewData || !draft) return;
    const placed = new Set(draft.flat());
    const remaining = previewData.players.map((p) => p.eventPlayerId).filter((id) => !placed.has(id));
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    updateDraft(draft.map((team) => team.map((id) => id ?? remaining.shift() ?? null)));
  };

  const draftProblem = previewData && draft
    ? teamDraftProblem(draft, previewData.players.map((p) => p.eventPlayerId), previewData.teamSize)
    : null;

  const handleConfirm = async () => {
    if (!previewData) return;
    if (isManual && (!draft || draftProblem)) return;

    try {
      setIsConfirming(true);
      await onConfirm(
        isManual && draft
          ? {
              ...toStartBracketRequest(previewData, teamDraftToPairings(draft)),
              ...(drawPreview ? { teamAssignment: 'manual' as const } : {}),
            }
          : toStartBracketRequest(previewData)
      );
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start bracket play',
        variant: 'destructive',
      });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setPreviewData(null);
      setDrawPreview(null);
      setDraft(null);
    }
    onOpenChange(newOpen);
  };

  const playerById = new Map(previewData?.players.map((player) => [player.eventPlayerId, player]));

  const isProcessing = isLoading || isRegenerating || isConfirming;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]">
        <DialogHeader className="gap-1.5 px-5 pt-[22px] pb-4 pr-14 text-left sm:px-7">
          <DialogTitle className="font-score text-[34px] leading-none">
            {isManual ? 'Build teams' : 'Team preview'}
          </DialogTitle>
          <DialogDescription>
            {previewData && `${describeTeamFormat(previewData.teamSize, previewData.teamAssignment)}. `}
            {isManual
              ? 'Put every player on a team, then start bracket play. Seeds follow combined score.'
              : 'Seeds follow combined score. Reshuffle for a new draw.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : previewData && isManual && draft ? (
            <div className="px-5 pb-4 sm:px-7">
              <ManualTeamEditor
                players={previewData.players}
                draft={draft}
                onChange={updateDraft}
                disabled={isProcessing}
              />
            </div>
          ) : previewData ? (
            <Table className="text-[15px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-16 pl-5 sm:pl-7">Seed</TableHead>
                  <TableHead>{previewData.teamSize === 1 ? 'Player' : 'Team members'}</TableHead>
                  <TableHead className="pr-5 text-right sm:pr-7">{previewData.teamSize === 1 ? 'Score' : 'Combined'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewData.teamPairings.map((team) => {
                  const members = sortBySlot(team.members)
                    .map((member) => playerById.get(member.eventPlayerId))
                    .filter((player): player is TeamPreviewPlayer => player !== undefined);

                  return (
                    <TableRow key={team.seed} className="border-muted hover:bg-transparent">
                      <TableCell className="py-3.5 pl-5 font-score text-[28px] leading-none font-bold tabular-nums sm:pl-7">
                        {team.seed}
                      </TableCell>
                      <TableCell className="py-3.5">
                        <div className="flex flex-col gap-1.5">
                          {members.map((player) => (
                            <div key={player.eventPlayerId} className="flex items-center gap-2">
                              <PoolBadge pool={player.pool} className="text-[11px]" />
                              <span>{player.playerName}</span>
                              <span
                                className={cn(
                                  'text-[13px] tabular-nums',
                                  player.scoringMethod === 'default' ? 'text-muted-foreground/70' : 'text-muted-foreground'
                                )}
                              >
                                {formatScore(player)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="py-3.5 pr-5 text-right sm:pr-7">
                        <CombinedTotal members={members} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </div>

        {isManual && draftProblem && (
          <p className="px-5 pb-3 text-center text-sm text-muted-foreground sm:px-7">{draftProblem}</p>
        )}

        <DialogFooter className="flex-wrap items-center gap-2.5 border-t px-5 py-[18px] sm:px-7">
          {isManual ? (
            <>
              {drawPreview && (
                <Button
                  variant="outline"
                  onClick={handleBackToDraw}
                  disabled={isProcessing}
                  className="w-full sm:w-auto"
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  Back to draw
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => previewData && updateDraft(emptyTeamDraft(previewData.players.length, previewData.teamSize))}
                disabled={isProcessing || !previewData}
                className="w-full sm:w-auto"
              >
                <Eraser className="mr-2 h-4 w-4" />
                Clear
              </Button>
              <Button
                variant="outline"
                onClick={handleFillRandomly}
                disabled={isProcessing || !previewData}
                className="w-full sm:w-auto"
              >
                <Shuffle className="mr-2 h-4 w-4" />
                Fill open slots
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleRegenerate}
                disabled={isProcessing}
                className="w-full sm:w-auto"
              >
                {isRegenerating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Shuffle className="mr-2 h-4 w-4" />
                )}
                Reshuffle
              </Button>
              {previewData && previewData.teamSize > 1 && (
                <Button
                  variant="ghost"
                  onClick={handleEditManually}
                  disabled={isProcessing}
                  className="w-full sm:w-auto"
                  title="Hand-pick teams, starting from this draw"
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Build teams by hand
                </Button>
              )}
            </>
          )}
          <span className="hidden flex-auto sm:block" aria-hidden="true" />
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isProcessing}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isProcessing || !previewData || (isManual && draftProblem !== null)}
            className="w-full sm:w-auto"
          >
            {isConfirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Start bracket play
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The team's seeding score. A team with a player who has no score history can't be
 * totalled, so it reads "Incomplete" (or "No data" if nobody has one).
 */
function CombinedTotal({ members }: { members: TeamPreviewPlayer[] }) {
  const scored = members.filter((player) => player.scoringMethod !== 'default').length;
  if (members.length === 0 || scored === 0) {
    return <span className="text-sm text-muted-foreground">{members.length === 0 ? '—' : 'No data'}</span>;
  }
  if (scored < members.length) {
    return <span className="text-sm text-muted-foreground">Incomplete</span>;
  }
  const total = members.reduce((sum, player) => sum + player.pfaScore, 0);
  return <span className="font-score text-[28px] leading-none font-bold tabular-nums">{total.toFixed(2)}</span>;
}
