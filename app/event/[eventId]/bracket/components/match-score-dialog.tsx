'use client';

import { useState, useEffect } from 'react';
import type { Match } from 'brackets-model';
import type { Team } from '@/app/event/[eventId]/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface OpponentData {
  id: number | null;
  score?: number;
  result?: 'win' | 'loss' | 'draw';
}

interface MatchScoreDialogProps {
  match: Match | null;
  team1?: Team;
  team2?: Team;
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScoreSubmit: () => void;
}

function getTeamName(team?: Team): string {
  if (!team) return 'TBD';
  return team.pool_combo || `Team ${team.seed}`;
}

export function MatchScoreDialog({
  match,
  team1,
  team2,
  eventId,
  open,
  onOpenChange,
  onScoreSubmit,
}: MatchScoreDialogProps) {
  const [score1, setScore1] = useState<string>('0');
  const [score2, setScore2] = useState<string>('0');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (match) {
      const opp1 = match.opponent1 as OpponentData | null;
      const opp2 = match.opponent2 as OpponentData | null;
      setScore1(String(opp1?.score ?? 0));
      setScore2(String(opp2?.score ?? 0));
      setError(null);
    }
  }, [match]);

  if (!match) return null;

  const opponent1 = match.opponent1 as OpponentData | null;
  const opponent2 = match.opponent2 as OpponentData | null;

  const handleSubmit = async () => {
    if (!match) return;

    const score1Num = parseInt(score1, 10);
    const score2Num = parseInt(score2, 10);

    if (isNaN(score1Num) || isNaN(score2Num)) {
      setError('Please enter valid scores');
      return;
    }

    if (score1Num < 0 || score2Num < 0) {
      setError('Scores cannot be negative');
      return;
    }

    if (score1Num === score2Num) {
      setError('Scores cannot be tied - there must be a winner');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/event/${eventId}/bracket/match/${match.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            opponent1Score: score1Num,
            opponent2Score: score2Num,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update score');
      }

      onScoreSubmit();
      onOpenChange(false);
      setScore1('0');
      setScore2('0');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update score');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enter Match Score</DialogTitle>
          <DialogDescription>
            Match {match.number} - Enter the final scores
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Team 1 */}
          <div className="space-y-2">
            <Label htmlFor="score1" className="flex items-center gap-2">
              {team1?.seed && (
                <span className="text-xs text-muted-foreground">
                  #{team1.seed}
                </span>
              )}
              {getTeamName(team1)}
            </Label>
            <Input
              id="score1"
              type="number"
              min="0"
              value={score1}
              onChange={(e) => setScore1(e.target.value)}
              className="text-2xl font-mono text-center h-14"
              disabled={!opponent1 || opponent1.id === null}
            />
          </div>

          <div className="text-center text-muted-foreground text-sm">vs</div>

          {/* Team 2 */}
          <div className="space-y-2">
            <Label htmlFor="score2" className="flex items-center gap-2">
              {team2?.seed && (
                <span className="text-xs text-muted-foreground">
                  #{team2.seed}
                </span>
              )}
              {getTeamName(team2)}
            </Label>
            <Input
              id="score2"
              type="number"
              min="0"
              value={score2}
              onChange={(e) => setScore2(e.target.value)}
              className="text-2xl font-mono text-center h-14"
              disabled={!opponent2 || opponent2.id === null}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Score'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
