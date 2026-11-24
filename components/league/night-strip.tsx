import { cn } from '@/lib/utils/utils';
import { formatMonthDay, formatShortDate } from '@/lib/utils/date-utils';
import type { LeagueSeason, NightState } from '@/lib/types/league';

const DOT: Record<NightState, string> = {
  done: 'bg-foreground',
  live: 'bg-success ring-[3px] ring-success/25',
  upcoming: 'border-2 border-muted-foreground bg-card',
};

/** A league's first and latest event dates with its latest nights as dots between them. */
export function NightStrip({ season, className }: { season: LeagueSeason; className?: string }) {
  const { first_event_date: first, latest_event_date: latest } = season;
  if (!first || !latest) return null;
  const spansYears = first.slice(0, 4) !== latest.slice(0, 4);
  const label = (date: string) => (spansYears ? formatShortDate(date) : formatMonthDay(date));
  const dateClass = 'text-xs font-bold tracking-[0.06em] whitespace-nowrap text-foreground/80 uppercase';
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}>
      <span className="inline-flex items-center gap-2">
        <span className={dateClass}>{label(first)}</span>
        {season.nights.length > 0 && (
          <span aria-hidden="true" className="relative flex h-4 items-center gap-[7px]">
            <span className="absolute inset-x-1 top-[7px] h-0.5 bg-border" />
            {season.nights.map((state, index) => (
              <span key={index} className={cn('relative size-2.5 shrink-0 rounded-full', DOT[state])} />
            ))}
          </span>
        )}
        {latest !== first && (
          <>
            <span className="sr-only">to</span>
            <span className={dateClass}>{label(latest)}</span>
          </>
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {season.night_count} {season.night_count === 1 ? 'night' : 'nights'}
      </span>
    </div>
  );
}
