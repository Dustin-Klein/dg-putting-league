'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/utils';
import { MAX_PUTTS, MIN_PUTTS, calculatePoints } from './scoring-utils';

const PUTT_OPTIONS = Array.from({ length: MAX_PUTTS - MIN_PUTTS + 1 }, (_, i) => MIN_PUTTS + i);

const SELECTED: Record<'team-1' | 'team-2' | 'primary', string> = {
  'team-1': 'border-team-1 bg-team-1 text-white',
  'team-2': 'border-team-2 bg-team-2 text-white',
  primary: 'border-primary bg-primary text-primary-foreground',
};

interface PuttScoreRowProps {
  label: string;
  /** Shown after the name, e.g. the player's pool. */
  subtitle?: ReactNode;
  /** Shown after the name, e.g. the player's handicap zone. */
  badge?: ReactNode;
  /** Replaces the points label on the right, e.g. a running total. */
  aside?: ReactNode;
  /** Shown between the name row and the buttons. */
  children?: ReactNode;
  score: number | null;
  bonusPointEnabled: boolean;
  /** Fill of the chosen button. */
  tone?: keyof typeof SELECTED;
  frameNumber?: number;
  /** Accessible name of the button group; defaults to "Putts made by {label}". */
  groupLabel?: string;
  disabled?: boolean;
  onChange: (puttsMade: number) => void;
}

/**
 * One player's putts for a frame: a row of 0–3 buttons (Main.dc.html). Picking a
 * button sets the score; the bonus is shown on the 3.
 */
export function PuttScoreRow({
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
  const points = score !== null ? calculatePoints(score, bonusPointEnabled) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-base font-semibold">{label}</span>
        {badge}
        {subtitle && <span className="shrink-0 text-xs font-semibold text-muted-foreground">{subtitle}</span>}
        <span className="ml-auto shrink-0 whitespace-nowrap">
          {aside ?? (
            <span className={cn('text-[13px] font-semibold', points === null && 'text-muted-foreground')}>
              {points === null ? 'Not scored' : `${points} ${points === 1 ? 'pt' : 'pts'}`}
            </span>
          )}
        </span>
      </div>
      {children}
      <div
        role="radiogroup"
        aria-label={`${groupLabel ?? `Putts made by ${label}`}${frameNumber ? `, frame ${frameNumber}` : ''}`}
        className="grid grid-cols-4 gap-1.5"
      >
        {PUTT_OPTIONS.map((putts) => {
          const selected = score === putts;
          const bonus = putts === MAX_PUTTS && bonusPointEnabled;
          return (
            <button
              key={putts}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${putts} putts made${bonus ? ', plus bonus point' : ''}`}
              disabled={disabled}
              onClick={() => onChange(putts)}
              className={cn(
                'flex h-14 flex-col items-center justify-center rounded-xl border-[1.5px] font-score text-[28px] leading-none font-bold transition-colors touch-manipulation outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
                selected ? SELECTED[tone] : 'border-input bg-control text-foreground hover:border-foreground/40'
              )}
            >
              {putts}
              {bonus && (
                <span className="mt-0.5 font-sans text-[10px] font-bold tracking-[0.06em]">+1 BONUS</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
