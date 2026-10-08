import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { event_players } from '@/lib/db/schema';
import { NotFoundError } from '@/lib/errors';

export async function getEventPlayerIds(ex: Executor, eventId: string): Promise<string[]> {
  const rows = await ex
    .select({ id: event_players.id })
    .from(event_players)
    .where(eq(event_players.event_id, eventId));
  return rows.map((r) => r.id);
}

export interface PoolAssignmentRow {
  event_player_id: string;
  pool: 'A' | 'B';
  pfa_score: number;
  scoring_method: string;
}

/**
 * Store each player's pool, score and scoring method. Throws if a player isn't in the event.
 */
export async function applyPoolAssignments(
  ex: Executor,
  eventId: string,
  assignments: PoolAssignmentRow[]
): Promise<void> {
  for (const a of assignments) {
    const updated = await ex
      .update(event_players)
      .set({ pool: a.pool, pfa_score: String(a.pfa_score), scoring_method: a.scoring_method })
      .where(and(eq(event_players.id, a.event_player_id), eq(event_players.event_id, eventId)))
      .returning({ id: event_players.id });
    if (updated.length === 0) {
      throw new NotFoundError(`Event player not found: ${a.event_player_id}`);
    }
  }
}
