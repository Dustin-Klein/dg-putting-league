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
import { useRoomyLayout } from './use-roomy-layout';
import { getAllPlayers, type MatchInfo, type ScoreState } from './wizard-types';

interface FrameWizardProps {
  match: MatchInfo;
  localScores: ScoreState;
  bonusPointEnabled: boolean;
  standardFrames: number;
  currentFrame: number;
  onScoreChange: (eventPlayerId: string, frameNumber: number, puttsMade: number) => void;
  onScoreClear: (eventPlayerId: string, frameNumber: number) => void;
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
  onScoreClear,
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

  const players = getAllPlayers(match);
  const scoredFrames = new Set(
    frameNumbers.filter((frameNumber) =>
      players.every(
        (player) => getResolvedScore(player.event_player_id, frameNumber, localScores, match.frames) !== null
      )
    )
  );
  const remaining = players.filter(
    (player) => getResolvedScore(player.event_player_id, currentFrame, localScores, match.frames) === null
  ).length;
  const currentLabel = frameLabel(currentFrame, standardFrames);
  const roomy = useRoomyLayout(Math.max(match.team_one.players.length, match.team_two.players.length));
  const teamProps = { frameNumber: currentFrame, match, localScores, bonusPointEnabled, roomy, onScoreChange, onScoreClear };

  return (
    // Sized to the screen (below the site nav from md up) so the totals and Next never scroll away.
    <div className="flex h-dvh flex-col bg-background md:h-[calc(100dvh-65px)]">
      <FrameWizardHeader
        match={match}
        isOvertime={isOvertime}
        showOvertimePrompt={showOvertimePrompt}
        onBack={onBack}
      >
        <FrameNavigation
          frameNumbers={frameNumbers}
          currentFrame={currentFrame}
          standardFrames={standardFrames}
          scoredFrames={scoredFrames}
          disabled={isSaving}
          className="min-w-0 flex-1 gap-1"
          buttonClassName={roomy ? 'h-[38px]' : 'h-[30px] rounded-lg text-sm'}
          onGoToFrame={(frameNumber) => {
            if (frameNumber === currentFrame) {
              return;
            }

            void runAction(() => onGoToFrame(frameNumber));
          }}
        />
      </FrameWizardHeader>

      {/* Scrolls only when the rows can't fit at their minimum height (e.g. a phone in landscape). */}
      <div
        className={cn(
          'relative w-full max-w-lg mx-auto flex min-h-0 flex-1 flex-col overflow-y-auto',
          roomy ? 'gap-2.5 px-3 py-2.5' : 'gap-1 px-2.5 py-1'
        )}
      >
        <TeamScoringSection team={match.team_one} teamNumber={1} total={teamOneTotal} {...teamProps} />
        <TeamScoringSection team={match.team_two} teamNumber={2} total={teamTwoTotal} {...teamProps} />
      </div>

      <ScoringFooter className="pt-2 pb-2.5">
        <p role="status" className="sr-only">
          {frameComplete
            ? `Frame ${currentLabel} complete`
            : `Enter scores for all players to continue · ${remaining} left`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-12 rounded-[14px] text-base"
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
            <Button className="flex-[2] h-12 rounded-[14px] text-base" onClick={() => void runAction(onFinish)} disabled={isSaving}>
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
              className="flex-[2] h-12 rounded-[14px] text-base"
              onClick={() => void runAction(onNextFrame)}
              disabled={!frameComplete || isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {isTied && currentFrame === Math.max(...frameNumbers) ? 'Overtime' : 'Next frame'}
                  {frameComplete ? (
                    <ArrowRight className="size-[18px]" />
                  ) : (
                    <span className="font-medium opacity-75">· {remaining} left</span>
                  )}
                </>
              )}
            </Button>
          )}
        </div>
      </ScoringFooter>
    </div>
  );
}
