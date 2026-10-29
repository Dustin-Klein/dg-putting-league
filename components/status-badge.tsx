import { cn } from '@/lib/utils/utils';
import type { EventStatus } from '@/lib/types/event';

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'outline' | 'waiting';

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/15 text-destructive',
  neutral: 'bg-muted text-foreground',
  outline: 'border border-input text-muted-foreground',
  waiting: 'border border-dashed border-input text-muted-foreground',
};

/**
 * The pill used for every event and match status (Foundations.dc.html "Badges"). The
 * text always names the status; color is never the only signal.
 */
export function StatusBadge({
  tone,
  dot = false,
  className,
  children,
}: {
  tone: StatusTone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold leading-none',
        TONE_CLASSES[tone],
        className
      )}
    >
      {dot && <span className="size-[7px] rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

const EVENT_STATUS: Record<EventStatus, { tone: StatusTone; label: string; dot?: boolean }> = {
  created: { tone: 'outline', label: 'Created' },
  'pre-bracket': { tone: 'warning', label: 'Pre-Bracket' },
  bracket: { tone: 'success', label: 'Bracket', dot: true },
  completed: { tone: 'neutral', label: 'Completed' },
};

export function EventStatusBadge({
  status,
  label,
  className,
}: {
  status: EventStatus;
  /** Overrides the default label, e.g. "In Progress" for a player's view. */
  label?: string;
  className?: string;
}) {
  const style = EVENT_STATUS[status] ?? { tone: 'outline' as const, label: status };
  return (
    <StatusBadge tone={style.tone} dot={style.dot} className={className}>
      {label ?? style.label}
    </StatusBadge>
  );
}
