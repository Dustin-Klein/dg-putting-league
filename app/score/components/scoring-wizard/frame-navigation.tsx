'use client';

import { cn } from '@/lib/utils/utils';

interface FrameNavigationProps {
  frameNumbers: number[];
  currentFrame: number;
  standardFrames: number;
  disabled: boolean;
  onGoToFrame: (frameNumber: number) => void;
}

export function FrameNavigation({
  frameNumbers,
  currentFrame,
  standardFrames,
  disabled,
  onGoToFrame,
}: FrameNavigationProps) {
  return (
    <div className="flex justify-center gap-1.5 mb-2">
      {frameNumbers.map((frameNumber) => (
        <button
          key={frameNumber}
          onClick={() => onGoToFrame(frameNumber)}
          disabled={disabled}
          className={cn(
            'w-7 h-7 rounded-full text-xs font-medium transition-all touch-manipulation disabled:opacity-50',
            frameNumber === currentFrame
              ? 'bg-primary text-primary-foreground scale-110'
              : 'bg-muted hover:bg-muted/80',
            frameNumber > standardFrames && 'bg-yellow-200 dark:bg-yellow-900'
          )}
          aria-label={`Go to frame ${frameNumber}`}
        >
          {frameNumber > standardFrames ? `O${frameNumber - standardFrames}` : frameNumber}
        </button>
      ))}
    </div>
  );
}
