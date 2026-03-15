'use client';

import { useMemo } from 'react';
import { getResolvedScore } from '@/app/score/components/scoring-wizard/scoring-utils';
import { useWizardActionState } from '@/app/score/components/scoring-wizard/use-wizard-action-state';
import {
  areScoresTiedWithLocalScores,
  getAllPlayers,
  getFrameNumbers,
  getTotalTeamScore,
  isOvertimeFrame,
  type MatchInfo,
  type ScoreState,
} from './wizard-types';

interface UseMatchFrameWizardOptions {
  match: MatchInfo;
  localScores: ScoreState;
  bonusPointEnabled: boolean;
  standardFrames: number;
  currentFrame: number;
}

export function useMatchFrameWizard({
  match,
  localScores,
  bonusPointEnabled,
  standardFrames,
  currentFrame,
}: UseMatchFrameWizardOptions) {
  const { isSaving, runAction } = useWizardActionState();

  const frameNumbers = useMemo(() => {
    const availableFrames = getFrameNumbers(match, standardFrames);

    return availableFrames.includes(currentFrame)
      ? availableFrames
      : [...availableFrames, currentFrame].sort((left, right) => left - right);
  }, [currentFrame, match, standardFrames]);

  const participants = useMemo(() => getAllPlayers(match), [match]);
  const frameComplete = participants.every(
    (player) =>
      getResolvedScore(player.event_player_id, currentFrame, localScores, match.frames) !== null
  );
  const isOvertime = isOvertimeFrame(currentFrame, standardFrames);
  const isLastRegularFrame = currentFrame === standardFrames;
  const isTied = areScoresTiedWithLocalScores(match, localScores, bonusPointEnabled, standardFrames);
  const showOvertimePrompt = isLastRegularFrame && isTied && frameComplete;
  const teamOneTotal = getTotalTeamScore(
    match.team_one,
    match,
    localScores,
    bonusPointEnabled,
    standardFrames
  );
  const teamTwoTotal = getTotalTeamScore(
    match.team_two,
    match,
    localScores,
    bonusPointEnabled,
    standardFrames
  );
  const isLastFrame = currentFrame === Math.max(...frameNumbers);
  const canFinish = frameComplete && !isTied && (isOvertime || isLastFrame);

  return {
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
  };
}
