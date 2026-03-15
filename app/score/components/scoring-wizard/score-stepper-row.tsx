'use client';

import { useCallback } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/utils';
import { MAX_PUTTS, MIN_PUTTS, calculatePoints } from './scoring-utils';

interface ScoreStepperRowProps {
  label: string;
  subtitle: string;
  score: number | null;
  bonusPointEnabled: boolean;
  disabled?: boolean;
  onChange: (puttsMade: number) => void;
}

export function ScoreStepperRow({
  label,
  subtitle,
  score,
  bonusPointEnabled,
  disabled = false,
  onChange,
}: ScoreStepperRowProps) {
  const handleIncrement = useCallback(() => {
    const nextScore = score === null ? 1 : Math.min(score + 1, MAX_PUTTS);
    onChange(nextScore);
  }, [onChange, score]);

  const handleDecrement = useCallback(() => {
    if (score === null) {
      onChange(0);
      return;
    }

    if (score > MIN_PUTTS) {
      onChange(score - 1);
    }
  }, [onChange, score]);

  const points = score !== null ? calculatePoints(score, bonusPointEnabled) : null;

  return (
    <div className="flex items-center justify-between bg-background/80 rounded-lg p-2">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{label}</div>
        <div className="text-xs text-muted-foreground">
          {subtitle}
          {points !== null && (
            <span className="ml-1 text-primary font-medium">
              → {points}pt
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-12 w-12 rounded-full"
          onClick={handleDecrement}
          disabled={disabled || (score !== null && score <= MIN_PUTTS)}
          aria-label="Decrease score"
        >
          <Minus className="h-5 w-5" />
        </Button>

        <div
          className={cn(
            'w-12 h-12 flex items-center justify-center text-xl font-mono font-bold rounded-lg border-2',
            score === null && 'text-muted-foreground border-dashed',
            score === MAX_PUTTS && 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300',
            score !== null && score < MAX_PUTTS && 'border-primary'
          )}
        >
          {points ?? '-'}
        </div>

        <Button
          variant="outline"
          size="icon"
          className="h-12 w-12 rounded-full"
          onClick={handleIncrement}
          disabled={disabled || (score !== null && score >= MAX_PUTTS)}
          aria-label="Increase score"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
