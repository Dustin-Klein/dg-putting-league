'use client';

import { ArrowRight, ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FrameNavigation } from '@/app/score/components/scoring-wizard/frame-navigation';
import { FrameWizardHeader } from './frame-wizard-header';
import { TeamScoringSection } from './team-scoring-section';
import { useMatchFrameWizard } from './use-match-frame-wizard';
import type { MatchInfo, ScoreState } from './wizard-types';

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
  const {
    canFinish,
    frameComplete,
    frameNumbers,
    isOvertime,
    isSaving,
    isTied,
    showOvertimePrompt,
    teamOneTotal,
    teamTwoTotal,
    runAction,
  } = useMatchFrameWizard({
    match,
    localScores,
    bonusPointEnabled,
    standardFrames,
    currentFrame,
  });

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-background p-3">
      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
        <FrameWizardHeader
          match={match}
          currentFrame={currentFrame}
          standardFrames={standardFrames}
          isOvertime={isOvertime}
          teamOneTotal={teamOneTotal}
          teamTwoTotal={teamTwoTotal}
          onBack={onBack}
        />

        {isOvertime && (
          <div className="mb-2 p-2 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg text-center">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Overtime – Continue until there&apos;s a winner
            </p>
          </div>
        )}

        {showOvertimePrompt && (
          <div className="mb-2 p-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg text-center">
            <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
              Tied! Continue to overtime
            </p>
          </div>
        )}

        <Card className="mb-2">
          <CardContent className="p-3">
            <TeamScoringSection
              team={match.team_one}
              teamNumber={1}
              frameNumber={currentFrame}
              match={match}
              localScores={localScores}
              bonusPointEnabled={bonusPointEnabled}
              onScoreChange={onScoreChange}
            />

            <div className="my-2 border-t" />

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

        <FrameNavigation
          frameNumbers={frameNumbers}
          currentFrame={currentFrame}
          standardFrames={standardFrames}
          disabled={isSaving}
          onGoToFrame={(frameNumber) => {
            if (frameNumber === currentFrame) {
              return;
            }

            void runAction(() => onGoToFrame(frameNumber));
          }}
        />

        <div className="flex gap-2 sticky bottom-0 mt-auto pt-2 pb-1 bg-background">
          <Button
            variant="outline"
            className="flex-1 h-12"
            onClick={() => void runAction(onPrevFrame)}
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
            <Button className="flex-1 h-12" onClick={() => void runAction(onFinish)} disabled={isSaving}>
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
              onClick={() => void runAction(onNextFrame)}
              disabled={!frameComplete || isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isTied && currentFrame === Math.max(...frameNumbers) ? (
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
