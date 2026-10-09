import 'server-only';
import { and, asc, count, eq, inArray, isNull, lte, notExists, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { bracket_match, event_players, frame_results, match_frames } from '@/lib/db/schema';
import { InternalError } from '@/lib/errors';
import type { MatchFrame } from '@/lib/types/scoring';

export interface FrameResultForMatch {
  id: string;
  match_frame_id: string;
  event_player_id: string;
  putts_made: number;
  points_earned: number;
}

/** Direct equivalent of get_frame_results_for_match; authorization belongs to the service. */
export async function getFrameResultsForMatch(
  ex: Executor,
  bracketMatchId: number
): Promise<FrameResultForMatch[]> {
  return ex
    .select({
      id: frame_results.id,
      match_frame_id: frame_results.match_frame_id,
      event_player_id: frame_results.event_player_id,
      putts_made: frame_results.putts_made,
      points_earned: frame_results.points_earned,
    })
    .from(frame_results)
    .innerJoin(bracket_match, eq(bracket_match.id, frame_results.bracket_match_id))
    .where(eq(frame_results.bracket_match_id, bracketMatchId));
}

/** Direct equivalent of get_frame_counts_for_matches. */
export async function getFrameCountsForMatches(
  ex: Executor,
  matchIds: number[]
): Promise<Record<number, number>> {
  if (matchIds.length === 0) return {};
  const rows = await ex
    .select({ bracket_match_id: match_frames.bracket_match_id, frame_count: count() })
    .from(match_frames)
    .where(inArray(match_frames.bracket_match_id, matchIds))
    .groupBy(match_frames.bracket_match_id);
  return Object.fromEntries(
    rows.flatMap((row) => row.bracket_match_id === null ? [] : [[row.bracket_match_id, Number(row.frame_count)]])
  );
}

export async function getMatchFrame(ex: Executor, frameId: string): Promise<MatchFrame> {
  const [frame] = await ex
    .select({
      id: match_frames.id,
      bracket_match_id: match_frames.bracket_match_id,
      frame_number: match_frames.frame_number,
      is_overtime: match_frames.is_overtime,
    })
    .from(match_frames)
    .where(eq(match_frames.id, frameId));
  if (!frame) throw new InternalError('Failed to fetch frame: not found');

  const results = await ex
    .select({
      id: frame_results.id,
      match_frame_id: frame_results.match_frame_id,
      event_player_id: frame_results.event_player_id,
      bracket_match_id: frame_results.bracket_match_id,
      putts_made: frame_results.putts_made,
      points_earned: frame_results.points_earned,
      order_in_frame: frame_results.order_in_frame,
    })
    .from(frame_results)
    .where(eq(frame_results.match_frame_id, frameId))
    .orderBy(asc(frame_results.order_in_frame));
  return { ...frame, bracket_match_id: frame.bracket_match_id ?? undefined, results };
}

/** Race-safe when called inside the service-owned transaction. */
export async function getOrCreateFrameWithResults(
  ex: Executor,
  bracketMatchId: number,
  frameNumber: number,
  isOvertime: boolean
): Promise<MatchFrame> {
  await ex
    .insert(match_frames)
    .values({ bracket_match_id: bracketMatchId, frame_number: frameNumber, is_overtime: isOvertime })
    .onConflictDoNothing({ target: [match_frames.bracket_match_id, match_frames.frame_number] });
  const [frame] = await ex
    .select({ id: match_frames.id })
    .from(match_frames)
    .where(and(eq(match_frames.bracket_match_id, bracketMatchId), eq(match_frames.frame_number, frameNumber)));
  if (!frame) throw new InternalError('Failed to create frame');
  return getMatchFrame(ex, frame.id);
}

/**
 * Distinct frame numbers that have at least one result, ascending. Empty frames (e.g.
 * pre-created by the create-only frame route) don't count.
 */
export async function getScoredFrameNumbers(ex: Executor, bracketMatchId: number): Promise<number[]> {
  const rows = await ex
    .selectDistinct({ frame_number: match_frames.frame_number })
    .from(match_frames)
    .innerJoin(frame_results, eq(frame_results.match_frame_id, match_frames.id))
    .where(eq(match_frames.bracket_match_id, bracketMatchId))
    .orderBy(asc(match_frames.frame_number));
  return rows.map((row) => row.frame_number);
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

/**
 * Frames recorded outside a bracket (hand-entered history) that hold results for the
 * event's players. They have no foreign key to the event, so deleting the event
 * cascades their results but not the frames.
 */
export async function getUnlinkedMatchFrameIdsForEvent(ex: Executor, eventId: string): Promise<string[]> {
  const rows = await ex
    .selectDistinct({ id: match_frames.id })
    .from(match_frames)
    .innerJoin(frame_results, eq(frame_results.match_frame_id, match_frames.id))
    .innerJoin(event_players, eq(event_players.id, frame_results.event_player_id))
    .where(and(isNull(match_frames.bracket_match_id), eq(event_players.event_id, eventId)));
  return rows.map((row) => row.id);
}

/** Delete the given unlinked frames that no longer hold any result. */
export async function deleteEmptyUnlinkedMatchFrames(ex: Executor, frameIds: string[]): Promise<void> {
  if (frameIds.length === 0) return;
  await ex.delete(match_frames).where(
    and(
      inArray(match_frames.id, frameIds),
      isNull(match_frames.bracket_match_id),
      notExists(ex.select({ id: frame_results.id }).from(frame_results).where(eq(frame_results.match_frame_id, match_frames.id)))
    )
  );
}
