'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Match } from 'brackets-model';
import type { Team } from '@/lib/types/team';
import type { BracketMatchWithDetails, PlayerInTeam } from '@/lib/types/scoring';
import { createClient } from '@/lib/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { ScoreInput } from '@/components/ui/score-input';

type ScoringMode = 'frames' | 'final';

interface MatchScoringDialogProps {
  match: Match | null;
  team1?: Team;
  team2?: Team;
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScoreSubmit: () => void;
  isCorrectionMode?: boolean;
}

export function MatchScoringDialog({
  match,
  eventId,
  open,
  onOpenChange,
  onScoreSubmit,
  isCorrectionMode = false,
}: MatchScoringDialogProps) {
  const [matchDetails, setMatchDetails] = useState<BracketMatchWithDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoringMode, setScoringMode] = useState<ScoringMode>('frames');
  const [finalScore1, setFinalScore1] = useState<string>('0');
  const [finalScore2, setFinalScore2] = useState<string>('0');
  const [isViewMode, setIsViewMode] = useState(true);

  // Track if we're currently saving to avoid refetch during our own updates
  const isSavingRef = useRef(false);

  const fetchMatchDetails = useCallback(async (showLoading = true) => {
    if (!match || !eventId) return;

    if (showLoading) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await fetch(
        `/api/event/${eventId}/bracket/match/${match.id}/scoring`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load match details');
      }

      const data = await response.json();
      setMatchDetails(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load match');
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, [match, eventId]);

  // Initial fetch when dialog opens
  useEffect(() => {
    if (open && match) {
      fetchMatchDetails(true);
      setIsViewMode(true);
    } else {
      setMatchDetails(null);
      setError(null);
      setScoringMode('frames');
      setFinalScore1('0');
      setFinalScore2('0');
      setIsViewMode(true);
    }
  }, [open, match, fetchMatchDetails]);

  // Sync final score inputs with match data
  useEffect(() => {
    if (matchDetails) {
      setFinalScore1(String(matchDetails.opponent1?.score ?? 0));
      setFinalScore2(String(matchDetails.opponent2?.score ?? 0));
    }
  }, [matchDetails]);

  // Realtime subscription for frame_results changes
  useEffect(() => {
    if (!open || !match) return;

    const supabase = createClient();
    const bracketMatchId = match.id;

    const channel = supabase
      .channel(`match-scoring-${bracketMatchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'frame_results',
          filter: `bracket_match_id=eq.${bracketMatchId}`,
        },
        () => {
          if (!isSavingRef.current) {
            fetchMatchDetails(false);
          }
        }
      );
    
    channel.subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [open, match, fetchMatchDetails]);

  const handleScoreChange = async (
    eventPlayerId: string,
    frameNumber: number,
    puttsMade: number
  ) => {
    if (!match || !eventId) return;

    const saveKey = `${eventPlayerId}-${frameNumber}`;
    setIsSaving(saveKey);
    isSavingRef.current = true;

    try {
      const response = await fetch(
        `/api/event/${eventId}/bracket/match/${match.id}/scoring`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frame_number: frameNumber,
            event_player_id: eventPlayerId,
            putts_made: puttsMade,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save score');
      }

      const updatedMatch = await response.json();
      setMatchDetails(updatedMatch);
    } catch (err) {
      console.error('Failed to save score:', err);
      setError(err instanceof Error ? err.message : 'Failed to save score');
    } finally {
      setIsSaving(null);
      isSavingRef.current = false;
    }
  };

  const handleComplete = async () => {
    if (!match || !eventId || !matchDetails) return;

    const team1Score = matchDetails.opponent1?.score ?? 0;
    const team2Score = matchDetails.opponent2?.score ?? 0;

    if (team1Score === team2Score) {
      setError('Scores are tied. Continue scoring in overtime until there is a winner.');
      return;
    }

    setIsCompleting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/event/${eventId}/bracket/match/${match.id}/scoring`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete match');
      }

      onScoreSubmit();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete match');
    } finally {
      setIsCompleting(false);
    }
  };

  const handleFinalScoreSubmit = async () => {
    if (!match || !eventId) return;

    const score1 = parseInt(finalScore1, 10);
    const score2 = parseInt(finalScore2, 10);

    if (isNaN(score1) || isNaN(score2)) {
      setError('Please enter valid scores');
      return;
    }

    if (score1 < 0 || score2 < 0) {
      setError('Scores cannot be negative');
      return;
    }

    if (score1 === score2) {
      setError('Scores cannot be tied - there must be a winner');
      return;
    }

    setIsCompleting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/event/${eventId}/bracket/match/${match.id}/scoring`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            team1_score: score1,
            team2_score: score2,
            is_correction: isCorrectionMode && isCompleted,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save score');
      }

      onScoreSubmit();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save score');
    } finally {
      setIsCompleting(false);
    }
  };

  const getPlayerScore = (eventPlayerId: string, frameNumber: number): number | null => {
    const frame = matchDetails?.frames?.find((f) => f.frame_number === frameNumber);
    const result = frame?.results?.find((r) => r.event_player_id === eventPlayerId);
    return result?.putts_made ?? null;
  };

  const getPlayerTotalPoints = (eventPlayerId: string): number => {
    let total = 0;
    for (const frame of matchDetails?.frames || []) {
      const result = frame.results?.find((r) => r.event_player_id === eventPlayerId);
      if (result) {
        total += result.points_earned;
      }
    }
    return total;
  };

  if (!match) return null;

  const team1Score = matchDetails?.opponent1?.score ?? 0;
  const team2Score = matchDetails?.opponent2?.score ?? 0;
  const isCompleted = matchDetails?.status === 4 || matchDetails?.status === 5;
  const isEditingLocked = isCompleted && !isCorrectionMode;

  // Get the standard frame count from event settings
  const standardFrames = matchDetails?.bracket_frame_count;

  if (standardFrames === undefined || standardFrames === null) {
    if (matchDetails) {
      return (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent>
            <div className="p-6 text-center text-destructive">
              Error: Match scoring configuration missing (frame count).
            </div>
          </DialogContent>
        </Dialog>
      );
    }
    return null;
  }

  // Determine how many frames to show
  const maxFrameNumber = Math.max(
    standardFrames,
    ...(matchDetails?.frames?.map((f) => f.frame_number) || [standardFrames])
  );
  const frameNumbers = Array.from({ length: maxFrameNumber }, (_, i) => i + 1);

  // Check if we need to add overtime frame
  const needsOvertime =
    matchDetails &&
    team1Score === team2Score &&
    matchDetails.frames &&
    matchDetails.frames.length >= standardFrames &&
    matchDetails.frames.every((f) => f.results?.length === 4);

  if (needsOvertime && frameNumbers.length === maxFrameNumber) {
    frameNumbers.push(maxFrameNumber + 1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        "max-h-[90vh] overflow-y-auto",
        scoringMode === 'frames' ? "max-w-4xl" : "max-w-md"
      )}>
        <DialogHeader>
          <DialogTitle>Match {match.number} Scoring</DialogTitle>
          <DialogDescription>
            {isViewMode
              ? 'Frame-by-frame results'
              : scoringMode === 'frames'
                ? 'Enter frame-by-frame scores for each player'
                : 'Enter final team scores'
            }
          </DialogDescription>
        </DialogHeader>

        {isCorrectionMode && (
          <div className="p-3 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded-md text-sm">
            Correcting completed match scores. Changes will not affect bracket progression.
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : matchDetails ? (
          <div>
            {/* Mode Toggle */}
            <div className="flex rounded-lg bg-muted p-1 mb-4">
              <button
                onClick={() => setScoringMode('frames')}
                className={cn(
                  "flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  scoringMode === 'frames'
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Frame Scores
              </button>
              <button
                onClick={() => setScoringMode('final')}
                className={cn(
                  "flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  scoringMode === 'final'
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Final Scores Only
              </button>
            </div>

            {scoringMode === 'frames' && (
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

              {/* Scoring Table */}
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
                        {/* Team 1 */}
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
                              <PlayerRow
                                key={player.event_player_id}
                                player={player}
                                frameNumbers={frameNumbers}
                                standardFrames={standardFrames}
                                getScore={getPlayerScore}
                                getTotalPoints={getPlayerTotalPoints}
                                onScoreChange={handleScoreChange}
                                isSaving={isSaving}
                                isCompleted={isViewMode || isEditingLocked}
                                bonusPointEnabled={matchDetails.bonus_point_enabled}
                              />
                            ))}
                          </>
                        )}

                        {/* Team 2 */}
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
                              <PlayerRow
                                key={player.event_player_id}
                                player={player}
                                frameNumbers={frameNumbers}
                                standardFrames={standardFrames}
                                getScore={getPlayerScore}
                                getTotalPoints={getPlayerTotalPoints}
                                onScoreChange={handleScoreChange}
                                isSaving={isSaving}
                                isCompleted={isViewMode || isEditingLocked}
                                bonusPointEnabled={matchDetails.bonus_point_enabled}
                              />
                            ))}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {error && (
                <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm text-center">
                  {error}
                </div>
              )}

              {/* Action area */}
              {isViewMode && !isEditingLocked ? (
                <div className="text-center pt-2">
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => setIsViewMode(false)}
                    className="min-w-[200px]"
                  >
                    Edit Scores
                  </Button>
                </div>
              ) : !isCompleted && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <Button
                    variant="ghost"
                    onClick={() => setIsViewMode(true)}
                    disabled={isCompleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="lg"
                    onClick={handleComplete}
                    disabled={isCompleting || team1Score === team2Score}
                    className="min-w-[200px]"
                  >
                    {isCompleting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Completing...
                      </>
                    ) : (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Complete Match
                      </>
                    )}
                  </Button>
                </div>
              )}
              {!isViewMode && !isCompleted && team1Score === team2Score && (
                <p className="text-sm text-muted-foreground mt-2 text-center">
                  Scores are tied. Continue scoring until there is a winner.
                </p>
              )}
              </div>
            )}

            {scoringMode === 'final' && (
              <div className="space-y-6">
              {/* Team 1 Score */}
              <div className="space-y-2">
                <Label htmlFor="score1" className="flex items-center gap-2">
                  {matchDetails.team_one?.seed && (
                    <span className="text-xs text-muted-foreground">
                      #{matchDetails.team_one.seed}
                    </span>
                  )}
                  {matchDetails.team_one?.pool_combo || 'Team 1'}
                </Label>
                <Input
                  id="score1"
                  type="number"
                  min="0"
                  value={finalScore1}
                  onChange={(e) => setFinalScore1(e.target.value)}
                  className="text-2xl font-mono text-center h-14"
                  disabled={isViewMode || isEditingLocked || isCompleting}
                />
              </div>

              <div className="text-center text-muted-foreground text-sm">vs</div>

              {/* Team 2 Score */}
              <div className="space-y-2">
                <Label htmlFor="score2" className="flex items-center gap-2">
                  {matchDetails.team_two?.seed && (
                    <span className="text-xs text-muted-foreground">
                      #{matchDetails.team_two.seed}
                    </span>
                  )}
                  {matchDetails.team_two?.pool_combo || 'Team 2'}
                </Label>
                <Input
                  id="score2"
                  type="number"
                  min="0"
                  value={finalScore2}
                  onChange={(e) => setFinalScore2(e.target.value)}
                  className="text-2xl font-mono text-center h-14"
                  disabled={isViewMode || isEditingLocked || isCompleting}
                />
              </div>

              {error && (
                <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm text-center">
                  {error}
                </div>
              )}

              {/* Save/Edit Button */}
              {isViewMode && !isEditingLocked ? (
                <div className="flex justify-end pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsViewMode(false)}
                  >
                    Edit Scores
                  </Button>
                </div>
              ) : !isEditingLocked && (
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsViewMode(true)}
                    disabled={isCompleting}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleFinalScoreSubmit} disabled={isCompleting}>
                    {isCompleting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Score'
                    )}
                  </Button>
                </div>
              )}
              </div>
            )}
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-destructive mb-4">{error}</p>
            <Button onClick={() => fetchMatchDetails(true)}>Retry</Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface PlayerRowProps {
  player: PlayerInTeam;
  frameNumbers: number[];
  standardFrames: number;
  getScore: (eventPlayerId: string, frameNumber: number) => number | null;
  getTotalPoints: (eventPlayerId: string) => number;
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
  isSaving: string | null;
  isCompleted: boolean;
  bonusPointEnabled: boolean;
}

function PlayerRow({
  player,
  frameNumbers,
  standardFrames,
  getScore,
  getTotalPoints,
  onScoreChange,
  isSaving,
  isCompleted,
  bonusPointEnabled,
}: PlayerRowProps) {
  return (
    <tr className="border-b">
      <td className="p-3">
        <div className="font-medium">{player.player.full_name}</div>
        <div className="text-xs text-muted-foreground">
          {player.role === 'A_pool' ? 'Pool A' : 'Pool B'}
        </div>
      </td>
      {frameNumbers.map((frameNum) => {
        const score = getScore(player.event_player_id, frameNum);
        const saveKey = `${player.event_player_id}-${frameNum}`;
        const isCurrentlySaving = isSaving === saveKey;

        return (
          <td
            key={frameNum}
            className={cn(
              "text-center p-1",
              frameNum > standardFrames && "bg-yellow-50/50 dark:bg-yellow-950/10"
            )}
          >
            <ScoreInput
              value={score}
              onChange={(val) => onScoreChange(player.event_player_id, frameNum, val)}
              disabled={isCompleted || isCurrentlySaving}
              isSaving={isCurrentlySaving}
              bonusPointEnabled={bonusPointEnabled}
            />
          </td>
        );
      })}
      <td className="text-center p-3 bg-muted font-mono font-bold text-lg">
        {getTotalPoints(player.event_player_id)}
      </td>
    </tr>
  );
}

