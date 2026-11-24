import type { EventStatus } from '@/lib/types/event';
import type { LeagueSeason, NightState } from '@/lib/types/league';

export interface LeagueNight<T> {
  main: T;
  secondChances: T[];
}

type NightEvent = { id: string; parent_event_id: string | null; event_date: string };

/** Nights shown in a league's dot strip. */
export const SEASON_STRIP_NIGHTS = 12;

/**
 * One night per main event, its same-day linked events attached, in the given order. A linked
 * event on another day, or whose parent isn't listed (e.g. hidden from this viewer), is its own night.
 */
export function groupEventsIntoNights<T extends NightEvent>(events: readonly T[]): LeagueNight<T>[] {
  const dateOf = new Map(events.map((event) => [event.id, event.event_date]));
  const nightOf = (event: T) =>
    event.parent_event_id && dateOf.get(event.parent_event_id) === event.event_date ? event.parent_event_id : null;
  const childrenOf = new Map<string, T[]>();
  for (const event of events) {
    const parent = nightOf(event);
    if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), event]);
  }
  return events
    .filter((event) => !nightOf(event))
    .map((event) => ({ main: event, secondChances: childrenOf.get(event.id) ?? [] }));
}

export function nightState(night: LeagueNight<{ status: EventStatus }>): NightState {
  if ([night.main, ...night.secondChances].some((event) => event.status === 'bracket')) return 'live';
  return night.main.status === 'completed' ? 'done' : 'upcoming';
}

export const newestFirst = <T extends { event_date: string }>(events: readonly T[]) =>
  [...events].sort((a, b) => b.event_date.localeCompare(a.event_date));

/** Season dates and the latest nights' states, oldest first, from every event the viewer can see. */
export function seasonSummary<T extends NightEvent & { status: EventStatus }>(events: readonly T[]): LeagueSeason {
  const sorted = newestFirst(events);
  const nights = groupEventsIntoNights(sorted);
  return {
    first_event_date: sorted.at(-1)?.event_date ?? null,
    latest_event_date: sorted[0]?.event_date ?? null,
    night_count: nights.length,
    nights: nights.slice(0, SEASON_STRIP_NIGHTS).map(nightState).reverse(),
  };
}

export type CurrentNightKind = 'live' | 'next' | 'latest';

/**
 * The night an organizer most needs: the live one, else the soonest not yet done, else the
 * latest. `nights` must be newest first.
 */
export function currentNight<T extends { status: EventStatus }>(
  nights: readonly LeagueNight<T>[]
): { kind: CurrentNightKind; night: LeagueNight<T> } | null {
  const live = nights.find((night) => nightState(night) === 'live');
  if (live) return { kind: 'live', night: live };
  const upcoming = nights.filter((night) => nightState(night) === 'upcoming');
  if (upcoming.length > 0) return { kind: 'next', night: upcoming[upcoming.length - 1] };
  return nights[0] ? { kind: 'latest', night: nights[0] } : null;
}
