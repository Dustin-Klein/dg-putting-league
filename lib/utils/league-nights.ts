export interface LeagueNight<T> {
  main: T;
  secondChances: T[];
}

/**
 * One night per main event, its linked events attached, in the given order. A linked event
 * whose parent isn't in the list (e.g. not visible to this viewer) becomes its own night.
 */
export function groupEventsIntoNights<T extends { id: string; parent_event_id: string | null }>(
  events: readonly T[]
): LeagueNight<T>[] {
  const ids = new Set(events.map((event) => event.id));
  const childrenOf = new Map<string, T[]>();
  for (const event of events) {
    if (event.parent_event_id && ids.has(event.parent_event_id)) {
      childrenOf.set(event.parent_event_id, [...(childrenOf.get(event.parent_event_id) ?? []), event]);
    }
  }
  return events
    .filter((event) => !event.parent_event_id || !ids.has(event.parent_event_id))
    .map((event) => ({ main: event, secondChances: childrenOf.get(event.id) ?? [] }));
}
