'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Check, Loader2, Trophy, Edit } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import type { MatchInfo, PlayerInfo } from './wizard-types';
import { STANDARD_FRAMES, getFrameNumbers } from './wizard-types';

interface ReviewSubmitProps {
  match: MatchInfo;
  isCompleting: boolean;
  error: string | null;
  onSubmit: () => void;
  onEditFrame: (frameNumber: number) => void;
  onBack: () => void;
}

export function ReviewSubmit({
  match,
  isCompleting,
  error,
  onSubmit,
  onEditFrame,
  onBack,
}: ReviewSubmitProps) {
  const frameNumbers = getFrameNumbers(match);
  const isTied = match.team_one_score === match.team_two_score;

  const team1Wins = match.team_one_score > match.team_two_score;
  const team2Wins = match.team_two_score > match.team_one_score;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Scoring
          </Button>
          <Badge variant="outline">Review</Badge>
        </div>

        {/* Match Result Card */}
        <Card className="mb-6">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl">Match Review</CardTitle>
            <CardDescription>
              Verify scores before submitting
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Final Score Display */}
            <div className="flex items-center justify-around text-center py-6 bg-muted/30 rounded-lg mb-4">
              <div className={cn(
                'px-4 py-2 rounded-lg',
                team1Wins && 'bg-green-100 dark:bg-green-900/30'
              )}>
                <div className="text-sm text-muted-foreground mb-1">
                  #{match.team_one.seed} {match.team_one.pool_combo}
                </div>
                <div className={cn(
                  "text-5xl font-mono font-bold",
                  team1Wins && "text-green-600"
                )}>
                  {match.team_one_score}
                </div>
                {team1Wins && (
                  <div className="flex items-center justify-center mt-1 text-green-600">
                    <Trophy className="h-4 w-4 mr-1" />
                    <span className="text-xs font-medium">Winner</span>
                  </div>
                )}
              </div>

              <div className="text-2xl text-muted-foreground">vs</div>

              <div className={cn(
                'px-4 py-2 rounded-lg',
                team2Wins && 'bg-green-100 dark:bg-green-900/30'
              )}>
                <div className="text-sm text-muted-foreground mb-1">
                  #{match.team_two.seed} {match.team_two.pool_combo}
                </div>
                <div className={cn(
                  "text-5xl font-mono font-bold",
                  team2Wins && "text-green-600"
                )}>
                  {match.team_two_score}
                </div>
                {team2Wins && (
                  <div className="flex items-center justify-center mt-1 text-green-600">
                    <Trophy className="h-4 w-4 mr-1" />
                    <span className="text-xs font-medium">Winner</span>
                  </div>
                )}
              </div>
            </div>

            {/* Tied Warning */}
            {isTied && (
              <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg text-center">
                <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                  Scores are tied
                </p>
                <p className="text-xs text-orange-700 dark:text-orange-300">
                  Go back and complete overtime frames until there&apos;s a winner
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detailed Scores Table */}
        <Card className="mb-6 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Score Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">Player</th>
                    {frameNumbers.map((num) => (
                      <th
                        key={num}
                        className={cn(
                          "text-center p-2 font-medium min-w-[40px]",
                          num > STANDARD_FRAMES && "bg-yellow-50 dark:bg-yellow-950/20"
                        )}
                      >
                        <button
                          onClick={() => onEditFrame(num)}
                          className="hover:underline flex items-center justify-center gap-0.5 mx-auto"
                          title={`Edit frame ${num}`}
                        >
                          {num > STANDARD_FRAMES ? `O${num - STANDARD_FRAMES}` : num}
                          <Edit className="h-3 w-3 opacity-50" />
                        </button>
                      </th>
                    ))}
                    <th className="text-center p-2 font-medium bg-muted">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Team 1 */}
                  <tr className="bg-blue-50/50 dark:bg-blue-950/20">
                    <td
                      colSpan={frameNumbers.length + 2}
                      className="p-1.5 text-xs font-semibold text-muted-foreground"
                    >
                      Team 1 - {match.team_one.pool_combo}
                    </td>
                  </tr>
                  {match.team_one.players.map((player) => (
                    <PlayerScoreRow
                      key={player.event_player_id}
                      player={player}
                      match={match}
                      frameNumbers={frameNumbers}
                    />
                  ))}

                  {/* Team 2 */}
                  <tr className="bg-orange-50/50 dark:bg-orange-950/20">
                    <td
                      colSpan={frameNumbers.length + 2}
                      className="p-1.5 text-xs font-semibold text-muted-foreground"
                    >
                      Team 2 - {match.team_two.pool_combo}
                    </td>
                  </tr>
                  {match.team_two.players.map((player) => (
                    <PlayerScoreRow
                      key={player.event_player_id}
                      player={player}
                      match={match}
                      frameNumbers={frameNumbers}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm text-center">
            {error}
          </div>
        )}

        {/* Submit Button */}
        <Button
          size="lg"
          className="w-full h-14 text-lg"
          onClick={onSubmit}
          disabled={isCompleting || isTied}
        >
          {isCompleting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Check className="mr-2 h-5 w-5" />
              Submit Match
            </>
          )}
        </Button>

        {isTied && (
          <p className="text-sm text-muted-foreground text-center mt-3">
            Cannot submit while scores are tied
          </p>
        )}
      </div>
    </div>
  );
}

interface PlayerScoreRowProps {
  player: PlayerInfo;
  match: MatchInfo;
  frameNumbers: number[];
}

function PlayerScoreRow({ player, match, frameNumbers }: PlayerScoreRowProps) {
  // Calculate total points for player
  let totalPoints = 0;
  for (const frame of match.frames) {
    const result = frame.results.find(r => r.event_player_id === player.event_player_id);
    if (result) {
      totalPoints += result.points_earned;
    }
  }

  return (
    <tr className="border-b">
      <td className="p-2">
        <div className="font-medium text-sm truncate max-w-[120px]">
          {player.full_name}
        </div>
      </td>
      {frameNumbers.map((frameNum) => {
        const frame = match.frames.find(f => f.frame_number === frameNum);
        const result = frame?.results.find(r => r.event_player_id === player.event_player_id);
        const putts = result?.putts_made;

        return (
          <td
            key={frameNum}
            className={cn(
              "text-center p-2 font-mono",
              frameNum > STANDARD_FRAMES && "bg-yellow-50/50 dark:bg-yellow-950/10",
              putts === 3 && "text-green-600 font-bold"
            )}
          >
            {putts ?? '-'}
          </td>
        );
      })}
      <td className="text-center p-2 bg-muted font-mono font-bold">
        {totalPoints}
      </td>
    </tr>
  );
}
