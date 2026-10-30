'use client';

import { ScoringBoard, LaneChip } from '@/app/score/components/scoring-wizard/scoring-board';
import type { ReactNode } from 'react';
import type { MatchInfo } from './wizard-types';

interface FrameWizardHeaderProps {
  match: MatchInfo;
  currentFrame: number;
  standardFrames: number;
  isOvertime: boolean;
  teamOneTotal: number;
  teamTwoTotal: number;
  onBack: () => void;
  /** The frame pips. */
  children?: ReactNode;
}

export function MatchMeta({ match }: { match: MatchInfo }) {
  return (
    <>
      <span className="truncate text-muted-foreground">{match.round_name}</span>
      {match.lane_label && <LaneChip label={match.lane_label} />}
    </>
  );
}

export function FrameWizardHeader({
  match,
  currentFrame,
  standardFrames,
  isOvertime,
  teamOneTotal,
  teamTwoTotal,
  onBack,
  children,
}: FrameWizardHeaderProps) {
  return (
    <ScoringBoard backLabel="Setup" onBack={onBack} meta={<MatchMeta match={match} />}>
      <div className="grid grid-cols-3 items-end">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold tracking-[0.06em] text-team-1-ink uppercase">
            Team 1 · #{match.team_one.seed}
          </span>
          <span className="font-score text-[56px] leading-[0.9] font-bold tabular-nums">
            <span className="sr-only">Team 1: </span>
            {teamOneTotal}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5 pb-1.5">
          <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">
            {isOvertime ? 'OVERTIME' : 'FRAME'}
          </span>
          <span className="font-score text-[28px] leading-none font-bold tabular-nums">
            {isOvertime ? `OT${currentFrame - standardFrames}` : `${currentFrame} / ${standardFrames}`}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-xs font-semibold tracking-[0.06em] text-team-2-ink uppercase">
            #{match.team_two.seed} · Team 2
          </span>
          <span className="font-score text-[56px] leading-[0.9] font-bold tabular-nums">
            <span className="sr-only">Team 2: </span>
            {teamTwoTotal}
          </span>
        </div>
      </div>
      {children}
    </ScoringBoard>
  );
}
