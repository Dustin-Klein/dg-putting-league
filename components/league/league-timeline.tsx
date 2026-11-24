import { cn } from '@/lib/utils/utils';
import { formatDateParts, formatDisplayDate } from '@/lib/utils/date-utils';
import type { LeagueNight } from '@/lib/utils/league-nights';
import type { EventStatus } from '@/lib/types/event';

type NightEvent = { id: string; event_date: string; status: EventStatus };

type NightState = 'live' | 'done' | 'upcoming';

function nightState(night: LeagueNight<NightEvent>): NightState {
  if ([night.main, ...night.secondChances].some((event) => event.status === 'bracket')) return 'live';
  return night.main.status === 'completed' ? 'done' : 'upcoming';
}

const DOT: Record<NightState, string> = {
  live: 'bg-success ring-success/25',
  done: 'bg-foreground ring-background',
  upcoming: 'bg-background ring-input',
};

/** Branch from a main event down to a linked event, drawn in the linked event's color. */
export function TimelineBranch({ dashed = false, children }: { dashed?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex pl-3 sm:pl-[22px]">
      <span
        aria-hidden="true"
        className={cn(
          'h-8 w-4 shrink-0 rounded-bl-xl border-b-2 border-l-2 sm:w-[22px]',
          dashed ? 'border-dashed border-input' : 'border-info/70'
        )}
      />
      <div className="mt-2.5 min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * League nights down a rail, newest first: the main event on top and each second chance
 * branching off it. Callers render each event's row; `after` adds a branch under a night.
 */
export function LeagueTimeline<T extends NightEvent>({
  nights,
  renderMain,
  renderSecondChance,
  after,
  label = 'Event nights',
}: {
  nights: LeagueNight<T>[];
  renderMain: (event: T, live: boolean) => React.ReactNode;
  renderSecondChance: (event: T) => React.ReactNode;
  after?: (night: LeagueNight<T>) => React.ReactNode;
  label?: string;
}) {
  const newestYear = nights[0] ? formatDateParts(nights[0].main.event_date).year : null;
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col p-0">
      {nights.map((night, index) => {
        const state = nightState(night);
        const date = formatDateParts(night.main.event_date);
        return (
          <li key={night.main.id} className="grid grid-cols-[52px_18px_minmax(0,1fr)] gap-x-2.5 sm:grid-cols-[96px_28px_minmax(0,1fr)] sm:gap-x-3.5">
            <div className="flex flex-col pt-3.5 text-right">
              <span className="sr-only">{formatDisplayDate(night.main.event_date)}</span>
              <span aria-hidden="true" className="text-xs font-bold tracking-[0.1em] text-muted-foreground">
                {date.month}
                {date.year !== newestYear && <span className="block sm:inline"> {date.year}</span>}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'font-score text-[30px] leading-[0.95] font-bold sm:text-4xl',
                  state === 'upcoming' && 'text-muted-foreground'
                )}
              >
                {date.day}
              </span>
            </div>
            <div aria-hidden="true" className="flex flex-col items-center">
              <span className={cn('h-[22px] w-0.5', index === 0 ? 'bg-transparent' : 'bg-border')} />
              <span className={cn('size-3.5 shrink-0 rounded-full ring-2', DOT[state])} />
              <span className="w-0.5 flex-1 bg-border" />
            </div>
            <div className="flex min-w-0 flex-col pt-1.5 pb-5">
              <div
                className={cn(
                  'rounded-[14px] border bg-card',
                  state === 'live' && night.main.status === 'bracket' && 'border-[1.5px] border-success'
                )}
              >
                {renderMain(night.main, state === 'live')}
              </div>
              {night.secondChances.map((event) => (
                <TimelineBranch key={event.id}>
                  <div
                    className={cn(
                      'rounded-xl bg-info/10',
                      event.status === 'bracket' && 'ring-[1.5px] ring-success'
                    )}
                  >
                    {renderSecondChance(event)}
                  </div>
                </TimelineBranch>
              ))}
              {after?.(night)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
