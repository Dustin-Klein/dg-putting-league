'use client';

import { PuttScoreRow, type PuttScoreRowProps } from './putt-score-row';
import { ScoreStepperRow } from './score-stepper-row';
import { useScoringMode } from './use-scoring-mode';

/** A player's score input for a frame, in this device's scoring mode. */
export function PlayerScoreInput(props: PuttScoreRowProps) {
  const [mode] = useScoringMode();
  return mode === 'david' ? <ScoreStepperRow {...props} /> : <PuttScoreRow {...props} />;
}
