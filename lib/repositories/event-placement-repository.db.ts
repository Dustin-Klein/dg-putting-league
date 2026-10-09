import 'server-only';
import type { Executor } from '@/lib/db/tx';
import { event_placements } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

export interface EventPlacementRow {
  eventId: string;
  teamId: string;
  placement: number;
}

export async function upsertEventPlacements(
  ex: Executor,
  placements: EventPlacementRow[]
): Promise<void> {
  if (placements.length === 0) return;
  await ex
    .insert(event_placements)
    .values(placements.map((placement) => ({
      event_id: placement.eventId,
      team_id: placement.teamId,
      placement: placement.placement,
    })))
    .onConflictDoUpdate({
      target: [event_placements.event_id, event_placements.team_id],
      set: { placement: sql`excluded.placement` },
    });
}
