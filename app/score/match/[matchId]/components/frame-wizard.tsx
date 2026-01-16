'use client';

import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  Minus,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import type { MatchInfo, PlayerInfo, TeamInfo, ScoreState } from './wizard-types';
import {
  STANDARD_FRAMES,
  MIN_PUTTS,
  MAX_PUTTS,
  getScoreKey,
  isOvertimeFrame,
  getFrameNumbers,
  calculatePoints,
  areScoresTiedWithLocalScores,
  getTotalTeamScore,
} from './wizard-types';

interface FrameWizardProps {
  match: MatchInfo;
  localScores: ScoreState;
  bonusPointEnabled: boolean;
  currentFrame: number;
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
  onNextFrame: () => Promise<void>;
  onPrevFrame: () => Promise<void>;
  onGoToFrame: (frameNumber: number) => Promise<void>;
  onFinish: () => Promise<void>;
  onBack: () => void;
}

export function FrameWizard({
  match,
  localScores,
  bonusPointEnabled,
  currentFrame,
  onScoreChange,
  onNextFrame,
  onPrevFrame,
  onGoToFrame,
  onFinish,
  onBack,
}: FrameWizardProps) {
  // Get frame numbers and ensure current frame is included (for new overtime frames)
  const baseFrameNumbers = getFrameNumbers(match);
  const frameNumbers = baseFrameNumbers.includes(currentFrame)
    ? baseFrameNumbers
    : [...baseFrameNumbers, currentFrame].sort((a, b) => a - b);
  const isOvertime = isOvertimeFrame(currentFrame);
  const isLastRegularFrame = currentFrame === STANDARD_FRAMES;
  const isTied = areScoresTiedWithLocalScores(match, localScores, bonusPointEnabled);
  const showOvertimePrompt = isLastRegularFrame && isTied && isCurrentFrameComplete();

  // Calculate live scores including local scores for display
  const teamOneTotal = getTotalTeamScore(match.team_one, match, localScores, bonusPointEnabled);
  const teamTwoTotal = getTotalTeamScore(match.team_two, match, localScores, bonusPointEnabled);

  // Helper to get score (local optimistic or server)
  function getPlayerScore(eventPlayerId: string, frameNumber: number): number | null {
    const key = getScoreKey(eventPlayerId, frameNumber);
    // Prefer local optimistic score if available
    if (localScores.has(key)) {
      return localScores.get(key)!;
    }
    // Fall back to server data
    const frame = match.frames.find(f => f.frame_number === frameNumber);
    const result = frame?.results.find(r => r.event_player_id === eventPlayerId);
    return result?.putts_made ?? null;
  }

  // Check if all players have scored in current frame
  function isCurrentFrameComplete(): boolean {
    const allPlayers = [...match.team_one.players, ...match.team_two.players];

    for (const player of allPlayers) {
      const score = getPlayerScore(player.event_player_id, currentFrame);
      if (score === null) {
        return false;
      }
    }

    return true;
  }

  // Determine if we can proceed
  const frameComplete = isCurrentFrameComplete();
  const isLastFrame = currentFrame === Math.max(...frameNumbers);
  // Can finish if frame is complete, not tied, and we're past regular frames or on the last frame
  const canFinish = frameComplete && !isTied && (isOvertime || isLastFrame);

  // Progress calculation
  const totalFrames = Math.max(STANDARD_FRAMES, frameNumbers.length);
  const progress = (currentFrame / totalFrames) * 100;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-lg mx-auto">
        {/* Header with back button and frame info */}
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Setup
          </Button>
          <div className="flex items-center gap-2">
            <Badge
              variant={isOvertime ? 'destructive' : 'default'}
              className="text-sm"
            >
              {isOvertime ? `OT${currentFrame - STANDARD_FRAMES}` : `Frame ${currentFrame}`}
            </Badge>
          </div>
        </div>

        {/* Prominent total score display */}
        <div className="mb-4 p-4 bg-muted/50 rounded-lg">
          <div className="flex items-center justify-center gap-4">
            <div className="text-center">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Team 1</div>
              <div className="text-4xl font-bold font-mono">{teamOneTotal}</div>
            </div>
            <div className="text-2xl text-muted-foreground font-light">–</div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Team 2</div>
              <div className="text-4xl font-bold font-mono">{teamTwoTotal}</div>
            </div>
          </div>
        </div>

        {/* Progress indicator */}
        <div className="mb-6">
          <Progress value={progress} className="h-2" />
          <div className="text-xs text-muted-foreground mt-1 text-center">
            Frame {currentFrame} of {isOvertime ? `${STANDARD_FRAMES}+OT` : STANDARD_FRAMES}
          </div>
        </div>

        {/* Overtime notice */}
        {isOvertime && (
          <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg text-center">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Overtime Frame {currentFrame - STANDARD_FRAMES}
            </p>
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              Continue until there&apos;s a winner
            </p>
          </div>
        )}

        {/* Overtime prompt */}
        {showOvertimePrompt && (
          <div className="mb-4 p-4 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg text-center">
            <p className="font-medium text-orange-800 dark:text-orange-200">
              Scores are tied!
            </p>
            <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
              Continue to overtime to determine a winner
            </p>
          </div>
        )}

        {/* Scoring Card */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-center">
              {isOvertime ? `Overtime ${currentFrame - STANDARD_FRAMES}` : `Frame ${currentFrame}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Team 1 */}
            <TeamScoringSection
              team={match.team_one}
              teamNumber={1}
              frameNumber={currentFrame}
              match={match}
              localScores={localScores}
              bonusPointEnabled={bonusPointEnabled}
              onScoreChange={onScoreChange}
            />

            {/* Divider */}
            <div className="my-4 border-t" />

            {/* Team 2 */}
            <TeamScoringSection
              team={match.team_two}
              teamNumber={2}
              frameNumber={currentFrame}
              match={match}
              localScores={localScores}
              bonusPointEnabled={bonusPointEnabled}
              onScoreChange={onScoreChange}
            />
          </CardContent>
        </Card>

        {/* Frame navigation dots */}
        <div className="flex justify-center gap-2 mt-6 mb-4">
          {frameNumbers.map((num) => (
            <button
              key={num}
              onClick={() => onGoToFrame(num)}
              className={cn(
                'w-8 h-8 rounded-full text-sm font-medium transition-all',
                num === currentFrame
                  ? 'bg-primary text-primary-foreground scale-110'
                  : 'bg-muted hover:bg-muted/80',
                num > STANDARD_FRAMES && 'bg-yellow-200 dark:bg-yellow-900'
              )}
              aria-label={`Go to frame ${num}`}
            >
              {num > STANDARD_FRAMES ? `O${num - STANDARD_FRAMES}` : num}
            </button>
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1 h-14"
            onClick={onPrevFrame}
            disabled={currentFrame === 1}
          >
            <ChevronLeft className="mr-1 h-5 w-5" />
            Previous
          </Button>

          {canFinish ? (
            <Button
              className="flex-1 h-14"
              onClick={onFinish}
            >
              Review Match
              <ArrowRight className="ml-1 h-5 w-5" />
            </Button>
          ) : (
            <Button
              className="flex-1 h-14"
              onClick={onNextFrame}
              disabled={!frameComplete}
            >
              {isTied && isLastFrame ? (
                <>
                  Overtime
                  <ArrowRight className="ml-1 h-5 w-5" />
                </>
              ) : (
                <>
                  Next Frame
                  <ArrowRight className="ml-1 h-5 w-5" />
                </>
              )}
            </Button>
          )}
        </div>

        {!frameComplete && (
          <p className="text-sm text-muted-foreground text-center mt-3">
            Enter scores for all players to continue
          </p>
        )}
      </div>
    </div>
  );
}

interface TeamScoringSectionProps {
  team: TeamInfo;
  teamNumber: 1 | 2;
  frameNumber: number;
  match: MatchInfo;
  localScores: ScoreState;
  bonusPointEnabled: boolean;
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
}

function TeamScoringSection({
  team,
  teamNumber,
  frameNumber,
  match,
  localScores,
  bonusPointEnabled,
  onScoreChange,
}: TeamScoringSectionProps) {
  const bgColor = teamNumber === 1
    ? 'bg-blue-50/50 dark:bg-blue-950/20'
    : 'bg-orange-50/50 dark:bg-orange-950/20';

  // Calculate team's score for this frame using local scores when available
  const frame = match.frames.find(f => f.frame_number === frameNumber);
  let frameScore = 0;
  for (const player of team.players) {
    const key = getScoreKey(player.event_player_id, frameNumber);
    let putts: number | undefined;

    // Prefer local optimistic score
    if (localScores.has(key)) {
      putts = localScores.get(key);
    } else {
      const result = frame?.results.find(r => r.event_player_id === player.event_player_id);
      putts = result?.putts_made;
    }

    if (putts !== undefined) {
      frameScore += calculatePoints(putts, bonusPointEnabled);
    }
  }

  return (
    <div className={cn('rounded-lg p-3', bgColor)}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-muted-foreground">
          Team {teamNumber} - {team.pool_combo}
        </span>
        <Badge variant="secondary" className="font-mono">
          {frameScore} pts
        </Badge>
      </div>
      <div className="space-y-3">
        {team.players.map((player) => (
          <PlayerScoreRow
            key={player.event_player_id}
            player={player}
            frameNumber={frameNumber}
            match={match}
            localScores={localScores}
            bonusPointEnabled={bonusPointEnabled}
            onScoreChange={onScoreChange}
          />
        ))}
      </div>
    </div>
  );
}

interface PlayerScoreRowProps {
  player: PlayerInfo;
  frameNumber: number;
  match: MatchInfo;
  localScores: ScoreState;
  bonusPointEnabled: boolean;
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
}

function PlayerScoreRow({
  player,
  frameNumber,
  match,
  localScores,
  bonusPointEnabled,
  onScoreChange,
}: PlayerScoreRowProps) {
  const key = getScoreKey(player.event_player_id, frameNumber);

  // Prefer local optimistic score for immediate feedback
  let currentScore: number | null;
  if (localScores.has(key)) {
    currentScore = localScores.get(key)!;
  } else {
    const frame = match.frames.find(f => f.frame_number === frameNumber);
    const result = frame?.results.find(r => r.event_player_id === player.event_player_id);
    currentScore = result?.putts_made ?? null;
  }

  const handleIncrement = useCallback(() => {
    const newScore = currentScore === null ? 0 : Math.min(currentScore + 1, MAX_PUTTS);
    onScoreChange(player.event_player_id, frameNumber, newScore);
  }, [currentScore, player.event_player_id, frameNumber, onScoreChange]);

  const handleDecrement = useCallback(() => {
    if (currentScore !== null && currentScore > MIN_PUTTS) {
      onScoreChange(player.event_player_id, frameNumber, currentScore - 1);
    }
  }, [currentScore, player.event_player_id, frameNumber, onScoreChange]);

  const points = currentScore !== null ? calculatePoints(currentScore, bonusPointEnabled) : null;

  return (
    <div className="flex items-center justify-between bg-background/80 rounded-lg p-3">
      {/* Player name (left side) */}
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{player.full_name}</div>
        <div className="text-xs text-muted-foreground">
          {player.role === 'A_pool' ? 'Pool A' : 'Pool B'}
          {points !== null && (
            <span className="ml-2 text-primary font-medium">
              → {points} pts
            </span>
          )}
        </div>
      </div>

      {/* Score stepper (right side) */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-12 w-12 rounded-full"
          onClick={handleDecrement}
          disabled={currentScore === null || currentScore <= MIN_PUTTS}
          aria-label="Decrease score"
        >
          <Minus className="h-5 w-5" />
        </Button>

        <div
          className={cn(
            'w-14 h-14 flex items-center justify-center text-2xl font-mono font-bold rounded-lg border-2',
            currentScore === null && 'text-muted-foreground border-dashed',
            currentScore === 3 && 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300',
            currentScore !== null && currentScore < 3 && 'border-primary'
          )}
        >
          {currentScore ?? '-'}
        </div>

        <Button
          variant="outline"
          size="icon"
          className="h-12 w-12 rounded-full"
          onClick={handleIncrement}
          disabled={currentScore !== null && currentScore >= MAX_PUTTS}
          aria-label="Increase score"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
