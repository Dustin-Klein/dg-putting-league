'use client';

import { useState, useEffect } from 'react';
import type { Match } from 'brackets-model';
import type { BracketMatchWithDetails } from '@/lib/types/scoring';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/utils';

interface MatchResultsDialogProps {
  match: Match | null;
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MatchResultsDialog({
  match,
  eventId,
  open,
  onOpenChange,
}: MatchResultsDialogProps) {
  const [matchDetails, setMatchDetails] = useState<BracketMatchWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !match || !eventId) {
      setMatchDetails(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(`/api/public/event/${eventId}/bracket/match/${match.id}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to load match results');
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setMatchDetails(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load match results');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, match, eventId]);

  if (!match) return null;

  const team1Score = matchDetails?.opponent1?.score ?? 0;
  const team2Score = matchDetails?.opponent2?.score ?? 0;
  const standardFrames = matchDetails?.bracket_frame_count ?? 0;
  const frames = matchDetails?.frames ?? [];

  const frameNumbers = standardFrames > 0
    ? Array.from(
        { length: Math.max(standardFrames, ...frames.map((f) => f.frame_number)) },
        (_, i) => i + 1
      )
    : [];

  const getPlayerScore = (eventPlayerId: string, frameNumber: number): number | null => {
    const frame = frames.find((f) => f.frame_number === frameNumber);
    const result = frame?.results?.find((r) => r.event_player_id === eventPlayerId);
    return result?.putts_made ?? null;
  };

  const getPlayerTotalPoints = (eventPlayerId: string): number => {
    let total = 0;
    for (const frame of frames) {
      const result = frame.results?.find((r) => r.event_player_id === eventPlayerId);
      if (result) total += result.points_earned;
    }
    return total;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Match {match.number} Results</DialogTitle>
          <DialogDescription>Frame-by-frame results</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-destructive">{error}</p>
          </div>
        ) : matchDetails ? (
          <div className="space-y-4">
            {/* Score Summary */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-around text-center">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">
                      #{matchDetails.team_one?.seed} {matchDetails.team_one?.pool_combo}
                    </div>
                    <div className={cn(
                      "text-4xl font-mono font-bold",
                      team1Score > team2Score && "text-green-600"
                    )}>
                      {team1Score}
                    </div>
                  </div>
                  <div className="text-2xl text-muted-foreground">vs</div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">
                      #{matchDetails.team_two?.seed} {matchDetails.team_two?.pool_combo}
                    </div>
                    <div className={cn(
                      "text-4xl font-mono font-bold",
                      team2Score > team1Score && "text-green-600"
                    )}>
                      {team2Score}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Frame-by-frame table */}
            {frames.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">No results recorded yet</p>
            ) : (
              <Card className="overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Frame Scores</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">Player</th>
                          {frameNumbers.map((num) => (
                            <th
                              key={num}
                              className={cn(
                                "text-center p-3 font-medium min-w-[60px]",
                                num > standardFrames && "bg-yellow-50 dark:bg-yellow-950/20"
                              )}
                            >
                              {num > standardFrames ? `OT${num - standardFrames}` : num}
                            </th>
                          ))}
                          <th className="text-center p-3 font-medium bg-muted min-w-[70px]">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchDetails.team_one && (
                          <>
                            <tr className="bg-blue-50/50 dark:bg-blue-950/20">
                              <td
                                colSpan={frameNumbers.length + 2}
                                className="p-2 text-xs font-semibold text-muted-foreground"
                              >
                                {matchDetails.team_one.pool_combo}
                              </td>
                            </tr>
                            {matchDetails.team_one.players.map((player) => (
                              <tr key={player.event_player_id} className="border-b">
                                <td className="p-3">
                                  <div className="font-medium">{player.player.full_name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {player.role === 'A_pool' ? 'Pool A' : 'Pool B'}
                                  </div>
                                </td>
                                {frameNumbers.map((frameNum) => {
                                  const score = getPlayerScore(player.event_player_id, frameNum);
                                  return (
                                    <td
                                      key={frameNum}
                                      className={cn(
                                        "text-center p-3 font-mono",
                                        frameNum > standardFrames && "bg-yellow-50/50 dark:bg-yellow-950/10"
                                      )}
                                    >
                                      {score ?? '—'}
                                    </td>
                                  );
                                })}
                                <td className="text-center p-3 bg-muted font-mono font-bold text-lg">
                                  {getPlayerTotalPoints(player.event_player_id)}
                                </td>
                              </tr>
                            ))}
                          </>
                        )}

                        {matchDetails.team_two && (
                          <>
                            <tr className="bg-orange-50/50 dark:bg-orange-950/20">
                              <td
                                colSpan={frameNumbers.length + 2}
                                className="p-2 text-xs font-semibold text-muted-foreground"
                              >
                                {matchDetails.team_two.pool_combo}
                              </td>
                            </tr>
                            {matchDetails.team_two.players.map((player) => (
                              <tr key={player.event_player_id} className="border-b">
                                <td className="p-3">
                                  <div className="font-medium">{player.player.full_name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {player.role === 'A_pool' ? 'Pool A' : 'Pool B'}
                                  </div>
                                </td>
                                {frameNumbers.map((frameNum) => {
                                  const score = getPlayerScore(player.event_player_id, frameNum);
                                  return (
                                    <td
                                      key={frameNum}
                                      className={cn(
                                        "text-center p-3 font-mono",
                                        frameNum > standardFrames && "bg-yellow-50/50 dark:bg-yellow-950/10"
                                      )}
                                    >
                                      {score ?? '—'}
                                    </td>
                                  );
                                })}
                                <td className="text-center p-3 bg-muted font-mono font-bold text-lg">
                                  {getPlayerTotalPoints(player.event_player_id)}
                                </td>
                              </tr>
                            ))}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
