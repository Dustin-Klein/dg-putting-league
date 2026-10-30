'use client';

import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils/utils';

interface ScoringBoardProps {
  backLabel: string;
  onBack: () => void;
  backDisabled?: boolean;
  /** Right side of the top row, e.g. the round and lane chip. */
  meta?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/**
 * The scoreboard band at the top of each scoring screen. Dark in both themes, like the
 * site header, so its contents use the dark tokens.
 */
export function ScoringBoard({ backLabel, onBack, backDisabled, meta, className, children }: ScoringBoardProps) {
  return (
    <header className="bg-board border-b border-board dark:border-border">
      <div className={cn('dark text-foreground max-w-lg mx-auto px-4 pt-2 pb-3.5 flex flex-col gap-2.5', className)}>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={backDisabled}
            className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-lg pr-2 text-[15px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
            {backLabel}
          </button>
          {meta && (
            <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">{meta}</div>
          )}
        </div>
        {children}
      </div>
    </header>
  );
}

/** The white lane chip on the scoreboard. */
export function LaneChip({ label }: { label: string }) {
  return (
    <span className="whitespace-nowrap rounded-full bg-foreground px-2.5 py-1 text-background">{label}</span>
  );
}

/** The sticky action bar at the bottom of each scoring screen. */
export function ScoringFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <footer className="sticky bottom-0 mt-auto bg-card border-t">
      <div className={cn('max-w-lg mx-auto px-4 pt-2.5 pb-[18px] flex flex-col gap-2', className)}>
        {children}
      </div>
    </footer>
  );
}
