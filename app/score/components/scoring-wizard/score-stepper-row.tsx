'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { MAX_PUTTS, MIN_PUTTS, calculatePoints } from './scoring-utils';
import type { PuttScoreRowProps, ScoreTone } from './putt-score-row';

const SCORED_BOX: Record<ScoreTone, string> = {
  'team-1': 'border-team-1 text-team-1-ink',
  'team-2': 'border-team-2 text-team-2-ink',
  primary: 'border-primary text-foreground',
};

interface PuttStepperProps {
  /** Accessible name of the group. */
  label: string;
  /** Names the − / + buttons, e.g. "Increase score for {playerName}". */
  playerName: string;
  score: number | null;
  bonusPointEnabled: boolean;
  tone?: ScoreTone;
  disabled?: boolean;
  onChange: (puttsMade: number) => void;
  className?: string;
  /** Replaces the default 52px circle size of the − / + buttons. */
  buttonClassName?: string;
  /** Replaces the default size of the points box. */
  boxClassName?: string;
  /** Classes on the number inside the box, e.g. its font size. */
  contentClassName?: string;
  iconClassName?: string;
}

/**
 * David scoring: − [points] +. From unscored, + gives 1 and − gives 0. The box shows
 * points, so 3 putts with the bonus reads 4.
 */
export function PuttStepper({
  label,
  playerName,
  score,
  bonusPointEnabled,
  tone = 'primary',
  disabled = false,
  onChange,
  className,
  buttonClassName,
  boxClassName,
  contentClassName,
  iconClassName,
}: PuttStepperProps) {
  const points = score !== null ? calculatePoints(score, bonusPointEnabled) : null;
  const button = cn(
    'flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-input bg-control text-foreground transition-colors touch-manipulation outline-none hover:border-foreground/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40 disabled:hover:border-input',
    buttonClassName ?? 'size-[52px]'
  );
  const icon = cn('size-5', iconClassName);

  return (
    <div role="group" aria-label={label} className={cn('flex shrink-0 items-center gap-1.5', className)}>
      <button
        type="button"
        className={button}
        onClick={() => onChange(score === null ? MIN_PUTTS : Math.max(score - 1, MIN_PUTTS))}
        disabled={disabled || (score !== null && score <= MIN_PUTTS)}
        aria-label={`Decrease score for ${playerName}`}
      >
        <Minus className={icon} strokeWidth={2.25} aria-hidden="true" />
      </button>

      <output
        aria-live="polite"
        className={cn(
          'flex items-center justify-center rounded-xl border-2 font-score font-bold leading-none tabular-nums',
          boxClassName ?? 'h-[52px] w-14',
          score === null
            ? 'border-dashed border-input bg-muted text-muted-foreground'
            : score === MAX_PUTTS
              ? 'border-success/45 bg-success/10 text-success'
              : cn('bg-card', SCORED_BOX[tone])
        )}
      >
        <span className={cn('text-[30px]', contentClassName)}>
          {points === null ? (
            <span className="sr-only">Not scored</span>
          ) : (
            <>
              {points}
              <span className="sr-only">{points === 1 ? ' point' : ' points'}</span>
            </>
          )}
        </span>
      </output>

      <button
        type="button"
        className={button}
        onClick={() => onChange(score === null ? MIN_PUTTS + 1 : Math.min(score + 1, MAX_PUTTS))}
        disabled={disabled || (score !== null && score >= MAX_PUTTS)}
        aria-label={`Increase score for ${playerName}`}
      >
        <Plus className={icon} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}

/** A player's name, how many putts were made, and the stepper: the David scoring PuttScoreRow. */
export function ScoreStepperRow({
  label,
  subtitle,
  badge,
  aside,
  children,
  score,
  bonusPointEnabled,
  tone = 'primary',
  frameNumber,
  groupLabel,
  disabled = false,
  onChange,
}: PuttScoreRowProps) {
  const atMax = score === MAX_PUTTS;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-base font-semibold">{label}</span>
        {badge}
        {subtitle && <span className="shrink-0 text-xs font-semibold text-muted-foreground">{subtitle}</span>}
        {aside && <span className="ml-auto shrink-0 whitespace-nowrap">{aside}</span>}
      </div>
      {children}
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'min-w-0 flex-1 text-[13px] font-semibold',
            score === null ? 'text-muted-foreground' : atMax ? 'text-success' : 'text-foreground'
          )}
        >
          {score === null ? (
            'Not scored'
          ) : (
            <>
              {score} of {MAX_PUTTS} made
              {atMax && bonusPointEnabled && <span className="block">+1 bonus</span>}
            </>
          )}
        </span>
        <PuttStepper
          label={`${groupLabel ?? `Putts made by ${label}`}${frameNumber ? `, frame ${frameNumber}` : ''}`}
          playerName={label}
          score={score}
          bonusPointEnabled={bonusPointEnabled}
          tone={tone}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
