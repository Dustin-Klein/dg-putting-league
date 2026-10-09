import 'server-only';
import { and, asc, eq, inArray, lte, max, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { frame_results, match_frames } from '@/lib/db/schema';

export async function getHighestFrameNumber(ex: Executor, bracketMatchId: number): Promise<number> {
  const [row] = await ex
    .select({ frame_number: max(match_frames.frame_number) })
    .from(match_frames)
    .where(eq(match_frames.bracket_match_id, bracketMatchId));
  return row?.frame_number ?? 0;
}

export async function getRegulationFrameResults(
  ex: Executor,
  bracketMatchId: number,
  throughFrame: number,
  eventPlayerIds: string[]
): Promise<Array<{ frame_number: number; event_player_id: string }>> {
  if (eventPlayerIds.length === 0) return [];
  return ex
    .select({
      frame_number: match_frames.frame_number,
      event_player_id: frame_results.event_player_id,
    })
    .from(match_frames)
    .innerJoin(frame_results, eq(frame_results.match_frame_id, match_frames.id))
    .where(
      and(
        eq(match_frames.bracket_match_id, bracketMatchId),
        lte(match_frames.frame_number, throughFrame),
        inArray(frame_results.event_player_id, eventPlayerIds)
      )
    )
    .orderBy(asc(match_frames.frame_number), asc(frame_results.event_player_id));
}

/**
 * Get the frame for (match, frame number), creating it if needed. Callers hold the
 * match row lock, so the read-then-insert can't race another writer for this match.
 */
export async function getOrCreateFrameId(
  ex: Executor,
  bracketMatchId: number,
  frameNumber: number,
  isOvertime: boolean
): Promise<string> {
  const [existing] = await ex
    .select({ id: match_frames.id })
    .from(match_frames)
    .where(and(eq(match_frames.bracket_match_id, bracketMatchId), eq(match_frames.frame_number, frameNumber)));
  if (existing) return existing.id;

  const [created] = await ex
    .insert(match_frames)
    .values({ bracket_match_id: bracketMatchId, frame_number: frameNumber, is_overtime: isOvertime })
    .returning({ id: match_frames.id });
  return created.id;
}

export interface FrameScoreInput {
  event_player_id: string;
  putts_made: number;
  points_earned: number;
}

/**
 * Upsert results for one frame. A player's first result in the frame gets the next
 * `order_in_frame`; a re-score keeps its order and refreshes `recorded_at`.
 * Callers hold the match row lock (order numbers are computed from current rows).
 */
export async function upsertFrameResults(
  ex: Executor,
  frameId: string,
  bracketMatchId: number,
  results: FrameScoreInput[]
): Promise<void> {
  if (results.length === 0) return;

  const existing = await ex
    .select({ event_player_id: frame_results.event_player_id, order_in_frame: frame_results.order_in_frame })
    .from(frame_results)
    .where(eq(frame_results.match_frame_id, frameId));

  const existingOrder = new Map(existing.map((r) => [r.event_player_id, r.order_in_frame]));
  let nextOrder = existing.reduce((max, r) => Math.max(max, r.order_in_frame), 0);

  const rows = results.map((r) => ({
    match_frame_id: frameId,
    event_player_id: r.event_player_id,
    bracket_match_id: bracketMatchId,
    putts_made: r.putts_made,
    points_earned: r.points_earned,
    order_in_frame: existingOrder.get(r.event_player_id) ?? ++nextOrder,
  }));

  await ex
    .insert(frame_results)
    .values(rows)
    .onConflictDoUpdate({
      target: [frame_results.match_frame_id, frame_results.event_player_id],
      set: {
        putts_made: sql`excluded.putts_made`,
        points_earned: sql`excluded.points_earned`,
        recorded_at: sql`now()`,
      },
    });
}
