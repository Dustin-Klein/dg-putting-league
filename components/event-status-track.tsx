import { cn } from '@/lib/utils/utils';
import type { EventStatus } from '@/lib/types/event';

const PHASES: Array<{ status: EventStatus; label: (qualifying: boolean) => string }> = [
  { status: 'created', label: () => 'Registration' },
  { status: 'pre-bracket', label: (qualifying) => (qualifying ? 'Qualifying' : 'Pre-bracket') },
  { status: 'bracket', label: () => 'Bracket' },
  { status: 'completed', label: () => 'Done' },
];

/** The four event phases as a segmented bar; the current phase fills by `progress`. */
export function StatusTrack({
  status,
  qualifying,
  progress,
  compact = false,
  className,
}: {
  status: EventStatus;
  qualifying: boolean;
  progress: { done: number; total: number } | null;
  compact?: boolean;
  className?: string;
}) {
  const current = PHASES.findIndex((phase) => phase.status === status);
  return (
    <ol
      aria-label="Event status"
      className={cn(
        'grid w-full grid-cols-4',
        compact ? 'max-w-[360px] gap-1 text-xs' : 'max-w-[624px] gap-1.5 text-[13px]',
        className
      )}
    >
      {PHASES.map((phase, index) => {
        const done = index < current || status === 'completed';
        const active = index === current && status !== 'completed';
        const fraction = active && progress && progress.total > 0 ? progress.done / progress.total : 0;
        return (
          <li
            key={phase.status}
            aria-current={index === current ? 'step' : undefined}
            className={cn(
              'flex min-w-0 flex-col font-semibold',
              compact ? 'gap-1' : 'gap-1.5',
              active ? 'font-bold' : done ? 'text-foreground/80' : 'text-muted-foreground'
            )}
          >
            <span className="h-1 overflow-hidden rounded-full bg-input" aria-hidden="true">
              <span
                className={cn('block h-full rounded-full', done || active ? 'bg-success' : 'bg-transparent')}
                style={{ width: done ? '100%' : active ? `${Math.max(fraction * 100, 6)}%` : '0%' }}
              />
            </span>
            <span className="truncate">
              {phase.label(qualifying)}
              {!compact && active && progress ? ` · ${progress.done} of ${progress.total}` : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
