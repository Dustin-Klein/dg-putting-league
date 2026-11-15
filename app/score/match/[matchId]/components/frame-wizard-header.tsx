'use client';

import { ScoringBoard, LaneChip } from '@/app/score/components/scoring-wizard/scoring-board';
import { ScoringSettingsButton } from '@/app/score/components/scoring-wizard/scoring-settings';
import type { ReactNode } from 'react';
import type { MatchInfo } from './wizard-types';

interface FrameWizardHeaderProps {
  match: MatchInfo;
  isOvertime: boolean;
  /** Tied after the last regular frame. */
  showOvertimePrompt: boolean;
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

/** Back, round and lane, then the frame pips. Team totals live on each team's card. */
export function FrameWizardHeader({ match, isOvertime, showOvertimePrompt, onBack, children }: FrameWizardHeaderProps) {
  return (
    <ScoringBoard
      backLabel="Setup"
      onBack={onBack}
      meta={
        <>
          <MatchMeta match={match} />
          <ScoringSettingsButton className="-my-1" />
        </>
      }
      className="pt-0.5 pb-2 gap-1"
      backClassName="min-h-9"
    >
      <div className="flex items-center gap-2.5">
        {isOvertime ? (
          <span role="status" className="shrink-0 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-bold tracking-[0.04em] text-warning uppercase">
            Overtime<span className="sr-only"> – continue until there&apos;s a winner</span>
          </span>
        ) : showOvertimePrompt ? (
          <span role="status" className="shrink-0 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-bold tracking-[0.04em] text-warning uppercase">
            Tied<span className="sr-only"> – continue to overtime</span>
          </span>
        ) : (
          <span className="shrink-0 text-[10px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Frame</span>
        )}
        {children}
      </div>
    </ScoringBoard>
  );
}
