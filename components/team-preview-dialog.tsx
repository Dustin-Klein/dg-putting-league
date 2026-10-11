'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
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
import { EventWithDetails } from '@/lib/types/event';
import type { TeamPreview, TeamPreviewPlayer } from '@/lib/types/team';
import { sortBySlot, toStartBracketRequest, type StartBracketRequest } from '@/lib/utils/team-utils';

interface TeamPreviewDialogProps {
  event: EventWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (request: StartBracketRequest) => Promise<void>;
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
  const [isConfirming, setIsConfirming] = useState(false);
  const [previewData, setPreviewData] = useState<TeamPreview | null>(null);

  const fetchPreview = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/event/${event.id}/team-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        let message = 'Failed to generate team preview';
        try {
          const errorData = await response.json();
          message = errorData?.error || message;
        } catch {
          message = response.statusText || message;
        }
        throw new Error(message);
      }

      const data = await response.json();
      setPreviewData(data);
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

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    await fetchPreview();
    setIsRegenerating(false);
  };

  const handleConfirm = async () => {
    if (!previewData) return;

    try {
      setIsConfirming(true);
      await onConfirm(toStartBracketRequest(previewData));
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
    }
    onOpenChange(newOpen);
  };

  const playerById = new Map(previewData?.players.map((player) => [player.eventPlayerId, player]));

  const isProcessing = isLoading || isRegenerating || isConfirming;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Team Preview</DialogTitle>
          <DialogDescription>
            Review the generated teams before starting bracket play. Click &quot;Regenerate Teams&quot; for new random pairings.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : previewData ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Seed</TableHead>
                    <TableHead>Team Members</TableHead>
                    <TableHead>Combined Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.teamPairings.map((team) => {
                    const members = sortBySlot(team.members)
                      .map((member) => playerById.get(member.eventPlayerId))
                      .filter((player): player is TeamPreviewPlayer => player !== undefined);

                    return (
                      <TableRow key={team.seed}>
                        <TableCell className="font-medium">
                          <Badge variant="outline">#{team.seed}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {members.map((player) => (
                              <div key={player.eventPlayerId} className="flex items-center gap-2">
                                <PoolBadge pool={player.pool} className="text-xs" />
                                <span className="font-medium">{player.playerName}</span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <CombinedScore members={members} total={team.combinedScore} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-center items-center flex-wrap">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isProcessing}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleRegenerate}
            disabled={isProcessing}
            className="w-full sm:w-auto"
          >
            {isRegenerating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Regenerate Teams
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isProcessing || !previewData}
            className="w-full sm:w-auto"
          >
            {isConfirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm & Start Bracket Play
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatScore(player: TeamPreviewPlayer): string {
  return player.scoringMethod === 'default' ? 'X' : player.pfaScore.toFixed(2);
}

/**
 * Member scores and their sum, e.g. "3.10 + 2.40 = 5.50". Players with no score
 * history show as X, and the sum reads "Incomplete" (or "No data" if nobody has one).
 */
export function CombinedScore({ members, total }: { members: TeamPreviewPlayer[]; total: number }) {
  const scored = members.filter((player) => player.scoringMethod !== 'default');
  const parts = members.map((player, index) => (
    <span key={player.eventPlayerId} className={player.scoringMethod === 'default' ? 'text-muted-foreground' : ''}>
      {index > 0 && ' + '}
      {formatScore(player)}
    </span>
  ));

  if (scored.length === 0) {
    return <span className="text-sm text-muted-foreground">{parts} = No data</span>;
  }
  if (scored.length < members.length) {
    return (
      <span className="text-sm">
        {parts} = <span className="text-muted-foreground">Incomplete</span>
      </span>
    );
  }
  return (
    <span className="text-sm font-medium">
      {members.length > 1 ? <>{parts} = </> : null}
      {total.toFixed(2)}
    </span>
  );
}
