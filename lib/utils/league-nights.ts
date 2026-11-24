export interface LeagueNight<T> {
  main: T;
  secondChances: T[];
}

/**
 * One night per main event, its same-day linked events attached, in the given order. A linked
 * event on another day, or whose parent isn't listed (e.g. hidden from this viewer), is its own night.
 */
export function groupEventsIntoNights<T extends { id: string; parent_event_id: string | null; event_date: string }>(
  events: readonly T[]
): LeagueNight<T>[] {
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
