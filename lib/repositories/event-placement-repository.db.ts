import 'server-only';
import { inArray, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { event_placements } from '@/lib/db/schema';

export interface EventPlacementRow { eventId: string; teamId: string; placement: number }
export type EventPlacement = EventPlacementRow;

export async function getStoredPlacementsForEvents(ex: Executor, eventIds: string[]): Promise<EventPlacement[]> {
  if (eventIds.length === 0) return [];
  return ex.select({ eventId: event_placements.event_id, teamId: event_placements.team_id, placement: event_placements.placement })
    .from(event_placements).where(inArray(event_placements.event_id, eventIds));
}

export async function getEventsWithStoredPlacements(ex: Executor, eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const rows = await ex.selectDistinct({ eventId: event_placements.event_id }).from(event_placements)
    .where(inArray(event_placements.event_id, eventIds));
  return new Set(rows.map((row) => row.eventId));
}

export async function upsertEventPlacements(ex: Executor, placements: EventPlacementRow[]): Promise<void> {
  if (placements.length === 0) return;
  await ex.insert(event_placements).values(placements.map((placement) => ({
    event_id: placement.eventId,
    team_id: placement.teamId,
    placement: placement.placement,
  }))).onConflictDoUpdate({
    target: [event_placements.event_id, event_placements.team_id],
    set: { placement: sql`excluded.placement` },
  });
}
