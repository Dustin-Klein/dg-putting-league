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
import { EventWithDetails } from '@/lib/types/event';

interface PoolAssignment {
  eventPlayerId: string;
  playerId: string;
  playerName: string;
  pool: 'A' | 'B';
  pfaScore: number;
  scoringMethod: 'qualification' | 'pfa' | 'default';
  defaultPool: 'A' | 'B';
}

interface TeamMemberPairing {
  eventPlayerId: string;
  role: 'A_pool' | 'B_pool';
}

interface TeamPairing {
  seed: number;
  poolCombo: string;
  combinedScore: number;
  members: TeamMemberPairing[];
}

interface TeamPreviewData {
  poolAssignments: PoolAssignment[];
  teamPairings: TeamPairing[];
}

interface TeamPreviewDialogProps {
  event: EventWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (data: TeamPreviewData) => Promise<void>;
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
  const [previewData, setPreviewData] = useState<TeamPreviewData | null>(null);

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
      await onConfirm(previewData);
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

  const getPlayerFromPoolAssignment = (eventPlayerId: string): PoolAssignment | undefined => {
    return previewData?.poolAssignments.find(pa => pa.eventPlayerId === eventPlayerId);
  };

  const formatScore = (score: number, scoringMethod: string): string => {
    if (scoringMethod === 'default') return 'X';
    return score.toFixed(2);
  };

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
                    const poolAMember = team.members.find(m => m.role === 'A_pool');
                    const poolBMember = team.members.find(m => m.role === 'B_pool');
                    const poolAPlayer = poolAMember ? getPlayerFromPoolAssignment(poolAMember.eventPlayerId) : undefined;
                    const poolBPlayer = poolBMember ? getPlayerFromPoolAssignment(poolBMember.eventPlayerId) : undefined;

                    const poolAHasScore = poolAPlayer?.scoringMethod !== 'default';
                    const poolBHasScore = poolBPlayer?.scoringMethod !== 'default';

                    const poolADisplay = poolAPlayer ? formatScore(poolAPlayer.pfaScore, poolAPlayer.scoringMethod) : 'X';
                    const poolBDisplay = poolBPlayer ? formatScore(poolBPlayer.pfaScore, poolBPlayer.scoringMethod) : 'X';

                    return (
                      <TableRow key={team.seed}>
                        <TableCell className="font-medium">
                          <Badge variant="outline">#{team.seed}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {poolAPlayer && (
                              <div className="flex items-center gap-2">
                                <Badge variant="default" className="text-xs">A</Badge>
                                <span className="font-medium">{poolAPlayer.playerName}</span>
                              </div>
                            )}
                            {poolBPlayer && (
                              <div className="flex items-center gap-2">
                                <Badge variant="default" className="text-xs bg-blue-500">B</Badge>
                                <span className="font-medium">{poolBPlayer.playerName}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {!poolAHasScore && !poolBHasScore ? (
                              <span className="text-muted-foreground">
                                {poolADisplay} + {poolBDisplay} = No data
                              </span>
                            ) : !poolAHasScore || !poolBHasScore ? (
                              <span>
                                <span className={!poolAHasScore ? 'text-muted-foreground' : ''}>
                                  {poolADisplay}
                                </span>
                                {' + '}
                                <span className={!poolBHasScore ? 'text-muted-foreground' : ''}>
                                  {poolBDisplay}
                                </span>
                                {' = '}
                                <span className="text-muted-foreground">Incomplete</span>
                              </span>
                            ) : (
                              <span className="font-medium">
                                {poolADisplay} + {poolBDisplay} = {team.combinedScore.toFixed(2)}
                              </span>
                            )}
                          </div>
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
