'use client';

import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/utils';
import { FrameNavigation, frameLabel } from '@/app/score/components/scoring-wizard/frame-navigation';
import { ScoringFooter } from '@/app/score/components/scoring-wizard/scoring-board';
import { getResolvedScore } from '@/app/score/components/scoring-wizard/scoring-utils';
import { FrameWizardHeader } from './frame-wizard-header';
import { TeamScoringSection } from './team-scoring-section';
import { useMatchFrameWizard } from './use-match-frame-wizard';
import { getAllPlayers, type MatchInfo, type ScoreState } from './wizard-types';

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

  const scoredFrames = new Set(
    frameNumbers.filter((frameNumber) =>
      getAllPlayers(match).every(
        (player) => getResolvedScore(player.event_player_id, frameNumber, localScores, match.frames) !== null
      )
    )
  );
  const remaining = getAllPlayers(match).filter(
    (player) => getResolvedScore(player.event_player_id, currentFrame, localScores, match.frames) === null
  ).length;
  const currentLabel = frameLabel(currentFrame, standardFrames);

  return (
    <div className="min-h-full flex flex-col bg-background">
      <FrameWizardHeader
        match={match}
        currentFrame={currentFrame}
        standardFrames={standardFrames}
        isOvertime={isOvertime}
        teamOneTotal={teamOneTotal}
        teamTwoTotal={teamTwoTotal}
        onBack={onBack}
      >
        <FrameNavigation
          frameNumbers={frameNumbers}
          currentFrame={currentFrame}
          standardFrames={standardFrames}
          scoredFrames={scoredFrames}
          disabled={isSaving}
          onGoToFrame={(frameNumber) => {
            if (frameNumber === currentFrame) {
              return;
            }

            void runAction(() => onGoToFrame(frameNumber));
          }}
        />
      </FrameWizardHeader>

      <div className="flex-1 w-full max-w-lg mx-auto px-4 py-3 flex flex-col gap-3">
        {isOvertime && (
          <div role="status" className="rounded-[10px] bg-warning/15 px-3 py-2.5 text-center text-sm font-semibold text-warning">
            Overtime – Continue until there&apos;s a winner
          </div>
        )}

        {showOvertimePrompt && (
          <div role="status" className="rounded-[10px] bg-warning/15 px-3 py-2.5 text-center text-sm font-semibold text-warning">
            Tied! Continue to overtime
          </div>
        )}

        <TeamScoringSection
          team={match.team_one}
          teamNumber={1}
          frameNumber={currentFrame}
          match={match}
          localScores={localScores}
          bonusPointEnabled={bonusPointEnabled}
          onScoreChange={onScoreChange}
        />

        <TeamScoringSection
          team={match.team_two}
          teamNumber={2}
          frameNumber={currentFrame}
          match={match}
          localScores={localScores}
          bonusPointEnabled={bonusPointEnabled}
          onScoreChange={onScoreChange}
        />
      </div>

      <ScoringFooter>
        <p
          className={cn(
            'text-center text-[13px] font-medium',
            frameComplete ? 'text-success' : 'text-muted-foreground'
          )}
        >
          {frameComplete
            ? `Frame ${currentLabel} complete`
            : `Enter scores for all players to continue · ${remaining} left`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-[54px] rounded-[14px] text-base"
            onClick={() => void runAction(onPrevFrame)}
            disabled={currentFrame === 1 || isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Prev'
            )}
          </Button>

          {canFinish ? (
            <Button className="flex-[2] h-[54px] rounded-[14px] text-base" onClick={() => void runAction(onFinish)} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Review match
                  <ArrowRight className="size-[18px]" />
                </>
              )}
            </Button>
          ) : (
            <Button
              className="flex-[2] h-[54px] rounded-[14px] text-base"
              onClick={() => void runAction(onNextFrame)}
              disabled={!frameComplete || isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isTied && currentFrame === Math.max(...frameNumbers) ? (
                <>
                  Overtime
                  <ArrowRight className="size-[18px]" />
                </>
              ) : (
                <>
                  Next frame
                  <ArrowRight className="size-[18px]" />
                </>
              )}
            </Button>
          )}
        </div>
      </ScoringFooter>
    </div>
  );
}
