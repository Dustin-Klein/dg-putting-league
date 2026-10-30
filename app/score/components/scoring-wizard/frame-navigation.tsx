'use client';

import { cn } from '@/lib/utils/utils';

interface FrameNavigationProps {
  frameNumbers: number[];
  currentFrame: number;
  standardFrames: number;
  /** Frames where every player has a score. */
  scoredFrames?: ReadonlySet<number>;
  disabled: boolean;
  onGoToFrame: (frameNumber: number) => void;
}

export function frameLabel(frameNumber: number, standardFrames: number): string {
  return frameNumber > standardFrames ? `OT${frameNumber - standardFrames}` : String(frameNumber);
}

/** Frame pips on the scoreboard band (rendered inside its dark scope). */
export function FrameNavigation({
  frameNumbers,
  currentFrame,
  standardFrames,
  scoredFrames,
  disabled,
  onGoToFrame,
}: FrameNavigationProps) {
  return (
    <nav aria-label="Frames" className="flex gap-1.5">
      {frameNumbers.map((frameNumber) => {
        const current = frameNumber === currentFrame;
        const scored = scoredFrames?.has(frameNumber) ?? false;
        return (
          <button
            key={frameNumber}
            type="button"
            onClick={() => onGoToFrame(frameNumber)}
            disabled={disabled}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'h-11 min-w-0 flex-1 rounded-[10px] border-[1.5px] text-[15px] font-bold transition-colors touch-manipulation outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
              current
                ? 'border-foreground bg-foreground text-background'
                : scored
                  ? 'border-transparent bg-foreground/15 text-foreground'
                  : 'border-dashed border-foreground/35 text-muted-foreground'
            )}
            aria-label={`Go to frame ${frameNumber}${scored ? ', scored' : ''}`}
          >
            {frameLabel(frameNumber, standardFrames)}
          </button>
        );
      })}
    </nav>
  );
}
