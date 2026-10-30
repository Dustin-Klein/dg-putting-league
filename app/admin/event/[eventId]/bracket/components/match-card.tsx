'use client';

import { useLayoutEffect, useRef, useState, useCallback } from 'react';
import type { Match } from 'brackets-model';
import type { Team } from '@/lib/types/team';
import { cn } from '@/lib/utils/utils';
import { Status } from 'brackets-model';
import { Check, Pencil, MapPin } from 'lucide-react';

interface OpponentData {
  id: number | null;
  score?: number;
  result?: 'win' | 'loss' | 'draw';
  position?: number;
}

interface MatchCardProps {
  match: Match;
  team1?: Team;
  team2?: Team;
  matchNumber: number;
  opponent1Placeholder?: string;
  opponent2Placeholder?: string;
  laneLabel?: string;
  isIdle?: boolean;
  onDeckPosition?: number;
  onClick?: () => void;
  isClickable?: boolean;
  isCorrectionMode?: boolean;
  framesCompleted?: number;
  totalFrames?: number;
}

function getTeamName(team?: Team): string {
  if (!team) return 'TBD';
  return team.pool_combo || `Team ${team.seed}`;
}

function ScrollingName({ name, className }: { name: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (container && text) {
      const overflow = text.scrollWidth - container.clientWidth;
      setOverflowPx(overflow > 0 ? overflow : 0);
    }
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [name, measure]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div ref={containerRef} className="overflow-hidden min-w-0">
      <span
        ref={textRef}
        className={cn('inline-block whitespace-nowrap', className)}
        style={overflowPx > 0 ? {
          animation: 'scroll-name 8s ease-in-out infinite',
          '--scroll-distance': `-${overflowPx}px`,
        } as React.CSSProperties : undefined}
      >
        {name}
      </span>
    </div>
  );
}

function OpponentRow({
  opponent,
  team,
  isWinner,
  isLoser,
  showScore,
  placeholder,
}: {
  opponent: OpponentData | null;
  team?: Team;
  isWinner: boolean;
  isLoser: boolean;
  showScore: boolean;
  placeholder?: string;
}) {
  if (!opponent || opponent.id == null) {
    return (
      <div className="flex flex-1 items-center px-2.5 text-sm text-muted-foreground">
        <span className="truncate italic">{placeholder || 'TBD'}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-between gap-2 px-2.5 text-sm">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {team?.seed && (
          <span className="w-[22px] shrink-0 font-score text-sm font-semibold text-muted-foreground tabular-nums">
            #{team.seed}
          </span>
        )}
        <ScrollingName
          name={getTeamName(team)}
          className={cn(isWinner ? 'font-bold' : 'font-medium', isLoser && 'text-muted-foreground')}
        />
      </div>
      {showScore && opponent.score !== undefined && (
        <span
          className={cn(
            'font-score text-[22px] leading-none font-bold tabular-nums shrink-0',
            isWinner && 'text-success',
            isLoser && 'text-muted-foreground'
          )}
        >
          {opponent.score}
        </span>
      )}
    </div>
  );
}

const STRIP_CLASSES = {
  running: 'bg-success/15 text-success',
  called: 'bg-warning/15 text-warning',
  idle: 'bg-destructive/15 text-destructive',
  'on-deck': 'bg-on-deck/15 text-on-deck',
  completed: 'bg-muted text-muted-foreground',
  waiting: 'text-muted-foreground',
} as const;

export function MatchCard({
  match,
  team1,
  team2,
  matchNumber,
  opponent1Placeholder,
  opponent2Placeholder,
  laneLabel,
  isIdle = false,
  onDeckPosition,
  onClick,
  isClickable = false,
  isCorrectionMode = false,
  framesCompleted,
  totalFrames,
}: MatchCardProps) {
  const opponent1 = match.opponent1 as OpponentData | null;
  const opponent2 = match.opponent2 as OpponentData | null;

  const showScore =
    match.status === Status.Running ||
    match.status === Status.Completed ||
    match.status === Status.Archived;

  const isComplete =
    match.status === Status.Completed ||
    match.status === Status.Archived;

  const team1IsWinner = isComplete && opponent1?.result === 'win';
  const team2IsWinner = isComplete && opponent2?.result === 'win';

  const showOnDeck = onDeckPosition !== undefined && onDeckPosition > 0 && !laneLabel && !isIdle &&
    (match.status === Status.Ready || match.status === Status.Waiting);

  const laneNumber = laneLabel?.match(/\d+/)?.[0] || laneLabel;

  const isCalled = !!laneLabel && !isIdle && match.status !== Status.Running && !isComplete;
  const state = isIdle
    ? 'idle'
    : match.status === Status.Running
      ? 'running'
      : isCalled
        ? 'called'
        : showOnDeck
          ? 'on-deck'
          : isComplete
            ? 'completed'
            : 'waiting';

  const hasFrames = match.status === Status.Running && framesCompleted !== undefined && totalFrames !== undefined;

  return (
    <div
      data-state={state}
      className={cn(
        'relative flex h-20 w-64 overflow-hidden rounded-xl border-2 text-card-foreground transition-all',
        state === 'waiting' ? 'border-dashed border-input bg-transparent' : 'bg-card',
        state === 'completed' && 'border-border',
        isClickable && 'cursor-pointer hover:border-foreground/40',
        match.status === Status.Running && 'border-success',
        isCalled && 'border-transparent shadow-[0_0_12px] shadow-warning/50',
        showOnDeck && 'border-transparent shadow-[0_0_12px] shadow-on-deck/50',
        isIdle && 'border-transparent shadow-[0_0_12px] shadow-destructive/50'
      )}
      onClick={isClickable ? onClick : undefined}
    >
      {isCalled && (
        <div className="absolute -inset-0.5 border-2 border-warning rounded-xl animate-pulse-ring pointer-events-none z-10" />
      )}
      {isIdle && (
        <div className="absolute -inset-0.5 border-2 border-destructive rounded-xl animate-pulse-ring-fast pointer-events-none z-10" />
      )}
      {showOnDeck && (
        <div className="absolute -inset-0.5 border-2 border-on-deck rounded-xl pointer-events-none z-10" />
      )}
      <div
        className={cn(
          'flex w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 self-stretch',
          STRIP_CLASSES[state]
        )}
      >
        <span className="flex items-center gap-0.5 font-score text-sm leading-none font-bold text-muted-foreground tabular-nums">
          {isCorrectionMode && (
            <Pencil className="size-2.5 text-warning" aria-label="Score can be corrected by an admin" />
          )}
          M{matchNumber}
        </span>
        {laneNumber && (
          <span className="flex items-center gap-0.5 font-score text-xl leading-none font-bold">
            <MapPin className="size-3" aria-hidden="true" />
            <span className="sr-only">Lane </span>
            {laneNumber}
          </span>
        )}
        {isComplete && !laneNumber && (
          <Check className="size-4" strokeWidth={3} aria-hidden="true" />
        )}
        {showOnDeck && (
          <span
            className="text-[9px] leading-tight text-center font-bold whitespace-nowrap uppercase"
            aria-label={`On deck #${onDeckPosition}`}
            title={`On deck #${onDeckPosition} in automatic lane assignment order`}
          >
            On deck
            <span className="block font-score text-base leading-none tabular-nums">#{onDeckPosition}</span>
          </span>
        )}
        {hasFrames ? (
          <span className="text-[10px] font-bold leading-none tabular-nums">
            {framesCompleted}/{totalFrames}
          </span>
        ) : (
          <span
            className="text-[10px] font-bold leading-none uppercase"
            title={isIdle ? 'Lane assigned 2+ minutes ago and scoring has not started' : undefined}
          >
            {state === 'running' ? 'Live' : state === 'called' ? 'Called' : state === 'idle' ? 'Idle' : isComplete ? 'Final' : ''}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col divide-y divide-muted">
        <OpponentRow
          opponent={opponent1}
          team={team1}
          isWinner={team1IsWinner}
          isLoser={team2IsWinner}
          showScore={showScore}
          placeholder={opponent1Placeholder}
        />
        <OpponentRow
          opponent={opponent2}
          team={team2}
          isWinner={team2IsWinner}
          isLoser={team1IsWinner}
          showScore={showScore}
          placeholder={opponent2Placeholder}
        />
      </div>
    </div>
  );
}
