'use client';

import { useLayoutEffect, useRef, useState, useCallback } from 'react';
import type { Match } from 'brackets-model';
import type { Team } from '@/lib/types/team';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils/utils';
import { Status } from 'brackets-model';
import { Pencil, MapPin } from 'lucide-react';

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
  laneLabel?: string;
  isIdle?: boolean;
  onClick?: () => void;
  isClickable?: boolean;
  isCorrectionMode?: boolean;
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
  showScore,
}: {
  opponent: OpponentData | null;
  team?: Team;
  isWinner: boolean;
  showScore: boolean;
}) {
  if (!opponent || opponent.id === null) {
    return (
      <div className="flex items-center justify-between px-2 py-1.5 text-sm text-muted-foreground">
        <span className="italic">TBD</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 px-2 py-1.5 text-sm',
        isWinner && 'bg-green-50 dark:bg-green-950/30'
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {team?.seed && (
          <span className="text-xs text-muted-foreground font-medium shrink-0">
            #{team.seed}
          </span>
        )}
        <ScrollingName
          name={getTeamName(team)}
          className={cn(isWinner && 'font-semibold')}
        />
      </div>
      {showScore && opponent.score !== undefined && (
        <span
          className={cn(
            'font-mono font-medium shrink-0',
            isWinner && 'text-green-600 dark:text-green-400'
          )}
        >
          {opponent.score}
        </span>
      )}
    </div>
  );
}

export function MatchCard({
  match,
  team1,
  team2,
  matchNumber,
  laneLabel,
  isIdle = false,
  onClick,
  isClickable = false,
  isCorrectionMode = false,
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

  const laneNumber = laneLabel?.match(/\d+/)?.[0] || laneLabel;

  return (
    <Card
      className={cn(
        'w-64 overflow-hidden transition-all relative',
        isClickable && 'cursor-pointer hover:shadow-md hover:border-primary/50',
        match.status === Status.Running && 'border-2 border-blue-400',
        laneLabel && !isIdle && match.status !== Status.Running && !isComplete && 'shadow-[0_0_12px_rgba(245,158,11,0.5)]',
        isIdle && 'shadow-[0_0_12px_rgba(239,68,68,0.5)]'
      )}
      onClick={isClickable ? onClick : undefined}
    >
      {laneLabel && !isIdle && match.status !== Status.Running && !isComplete && (
        <div className="absolute inset-0 border-2 border-amber-500 rounded-[inherit] animate-pulse-ring pointer-events-none z-10" />
      )}
      {isIdle && (
        <div className="absolute inset-0 border-2 border-red-500 rounded-[inherit] animate-pulse-ring-fast pointer-events-none z-10" />
      )}
      {isCorrectionMode && (
        <div className="absolute top-0 left-0">
          <Pencil className="h-3 w-3 text-amber-600 dark:text-amber-400 m-1" />
        </div>
      )}
      <div className="flex">
        <div className="flex flex-col items-center justify-center px-1.5 py-1 bg-muted/50 border-r min-w-[40px]">
          <span className="text-sm font-medium text-muted-foreground">
            M{matchNumber}
          </span>
          {laneNumber && (
            <div className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
              <MapPin className="h-2.5 w-2.5" aria-hidden="true" />
              <span className="text-sm font-medium">{laneNumber}</span>
            </div>
          )}
        </div>
        <CardContent className="p-0 divide-y flex-1 min-w-0">
          <OpponentRow
            opponent={opponent1}
            team={team1}
            isWinner={team1IsWinner}
            showScore={showScore}
          />
          <OpponentRow
            opponent={opponent2}
            team={team2}
            isWinner={team2IsWinner}
            showScore={showScore}
          />
        </CardContent>
      </div>
    </Card>
  );
}
