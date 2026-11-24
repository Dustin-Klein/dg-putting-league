import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils/utils';

/** The icon and label that mark a second-chance event everywhere it appears. */
export function SecondChanceMark({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-bold text-info', className)}>
      <RotateCcw className={cn('size-4 shrink-0', iconClassName)} strokeWidth={2.25} aria-hidden="true" />
      Second chance
    </span>
  );
}
