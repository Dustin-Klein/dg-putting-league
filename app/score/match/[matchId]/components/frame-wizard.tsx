'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  Loader2,
  Minus,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import type { MatchInfo, PlayerInfo, TeamInfo, ScoreState } from './wizard-types';
import {
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
  standardFrames: number;
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
  standardFrames,
  currentFrame,
  onScoreChange,
  onNextFrame,
  onPrevFrame,
  onGoToFrame,
  onFinish,
  onBack,
}: FrameWizardProps) {
  const [isSaving, setIsSaving] = useState(false);

  // Get frame numbers and ensure current frame is included (for new overtime frames)
  const baseFrameNumbers = getFrameNumbers(match, standardFrames);
  const frameNumbers = baseFrameNumbers.includes(currentFrame)
    ? baseFrameNumbers
    : [...baseFrameNumbers, currentFrame].sort((a, b) => a - b);
  const isOvertime = isOvertimeFrame(currentFrame, standardFrames);
  const isLastRegularFrame = currentFrame === standardFrames;
  const isTied = areScoresTiedWithLocalScores(match, localScores, bonusPointEnabled, standardFrames);
  const showOvertimePrompt = isLastRegularFrame && isTied && isCurrentFrameComplete();

  // Calculate live scores including local scores for display
  const teamOneTotal = getTotalTeamScore(match.team_one, match, localScores, bonusPointEnabled, standardFrames);
  const teamTwoTotal = getTotalTeamScore(match.team_two, match, localScores, bonusPointEnabled, standardFrames);

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

  const handlePrevFrame = async () => {
    setIsSaving(true);
    try {
      await onPrevFrame();
    } finally {
      setIsSaving(false);
    }
  };

  const handleNextFrame = async () => {
    setIsSaving(true);
    try {
      await onNextFrame();
    } finally {
      setIsSaving(false);
    }
  };

  const handleGoToFrame = async (frameNumber: number) => {
    if (frameNumber === currentFrame) return;
    setIsSaving(true);
    try {
      await onGoToFrame(frameNumber);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinish = async () => {
    setIsSaving(true);
    try {
      await onFinish();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-background p-3">
      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
        {/* Header with back button, score, and frame info */}
        <div className="flex items-center justify-between mb-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-8 px-2">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Setup
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-2xl font-bold font-mono">
              <span>{teamOneTotal}</span>
              <span className="text-muted-foreground text-lg">–</span>
              <span>{teamTwoTotal}</span>
            </div>
            <Badge
              variant={isOvertime ? 'destructive' : 'default'}
              className="text-sm"
            >
              {isOvertime ? `OT${currentFrame - standardFrames}` : `F${currentFrame}`}
            </Badge>
          </div>
        </div>

        {/* Overtime notice */}
        {isOvertime && (
          <div className="mb-2 p-2 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg text-center">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Overtime – Continue until there&apos;s a winner
            </p>
          </div>
        )}

        {/* Overtime prompt */}
        {showOvertimePrompt && (
          <div className="mb-2 p-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg text-center">
            <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
              Tied! Continue to overtime
            </p>
          </div>
        )}

        {/* Scoring Card */}
        <Card className="mb-2">
          <CardContent className="p-3">
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
            <div className="my-2 border-t" />

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
        <div className="flex justify-center gap-1.5 mb-2">
          {frameNumbers.map((num) => (
            <button
              key={num}
              onClick={() => handleGoToFrame(num)}
              disabled={isSaving}
              className={cn(
                'w-7 h-7 rounded-full text-xs font-medium transition-all touch-manipulation disabled:opacity-50',
                num === currentFrame
                  ? 'bg-primary text-primary-foreground scale-110'
                  : 'bg-muted hover:bg-muted/80',
                num > standardFrames && 'bg-yellow-200 dark:bg-yellow-900'
              )}
              aria-label={`Go to frame ${num}`}
            >
              {num > standardFrames ? `O${num - standardFrames}` : num}
            </button>
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="flex gap-2 sticky bottom-0 mt-auto pt-2 pb-1 bg-background">
          <Button
            variant="outline"
            className="flex-1 h-12"
            onClick={handlePrevFrame}
            disabled={currentFrame === 1 || isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Prev
              </>
            )}
          </Button>

          {canFinish ? (
            <Button
              className="flex-1 h-12"
              onClick={handleFinish}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Review
                  <ArrowRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          ) : (
            <Button
              className="flex-1 h-12"
              onClick={handleNextFrame}
              disabled={!frameComplete || isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isTied && isLastFrame ? (
                <>
                  Overtime
                  <ArrowRight className="ml-1 h-4 w-4" />
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
          )}
        </div>

        {!frameComplete && (
          <p className="text-xs text-muted-foreground text-center mt-1">
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
    <div className={cn('rounded-lg p-2', bgColor)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">
          #{team.seed} {team.pool_combo}
        </span>
        <Badge variant="secondary" className="font-mono text-xs h-5">
          {frameScore} pts
        </Badge>
      </div>
      <div className="space-y-2">
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
    <div className="flex items-center justify-between bg-background/80 rounded-lg p-2">
      {/* Player name (left side) */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{player.full_name}</div>
        <div className="text-xs text-muted-foreground">
          {player.role === 'A_pool' ? 'A' : 'B'}
          {points !== null && (
            <span className="ml-1 text-primary font-medium">
              → {points}pt
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
            'w-12 h-12 flex items-center justify-center text-xl font-mono font-bold rounded-lg border-2',
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
