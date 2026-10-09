import 'server-only';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Status } from 'brackets-model';
import type { Executor, Tx } from '@/lib/db/tx';
import { bracket_match, bracket_round, lanes } from '@/lib/db/schema';
import type { Lane } from '@/lib/types/bracket';

/**
 * Lock all of an event's lanes (ascending id, per the lock order) and return them.
 */
export async function lockEventLanes(tx: Tx, eventId: string): Promise<Lane[]> {
  const rows = await tx
    .select()
    .from(lanes)
    .where(eq(lanes.event_id, eventId))
    .orderBy(asc(lanes.id))
    .for('update');
  return rows as Lane[];
}

export async function hasLanes(ex: Executor, eventId: string): Promise<boolean> {
  const rows = await ex.select({ id: lanes.id }).from(lanes).where(eq(lanes.event_id, eventId)).limit(1);
  return rows.length > 0;
}

export async function getMatchAssignedToLane(
  ex: Executor,
  eventId: string,
  laneId: string
): Promise<{ id: number; status: number } | null> {
  const [match] = await ex
    .select({ id: bracket_match.id, status: bracket_match.status })
    .from(bracket_match)
    .where(and(eq(bracket_match.event_id, eventId), eq(bracket_match.lane_id, laneId)))
    .limit(1);
  return match ?? null;
}

export async function insertLanes(ex: Executor, eventId: string, count: number): Promise<void> {
  if (count <= 0) return;
  await ex.insert(lanes).values(
    Array.from({ length: count }, (_, i) => ({ event_id: eventId, label: `Lane ${i + 1}`, status: 'idle' as const }))
  );
}

export interface UnassignedMatch {
  id: number;
  round_id: number;
  number: number;
  status: number;
}

/**
 * Ready/Waiting matches with both slots filled and no lane, in play order:
 * lower rounds first, Ready before Waiting, longest waiting first, then match number.
 */
export async function getUnassignedReadyMatches(ex: Executor, stageId: number): Promise<UnassignedMatch[]> {
  const rows = await ex
    .select({
      id: bracket_match.id,
      round_id: bracket_match.round_id,
      number: bracket_match.number,
      status: bracket_match.status,
      round_number: bracket_round.number,
      updated_at: bracket_match.updated_at,
    })
    .from(bracket_match)
    .innerJoin(bracket_round, eq(bracket_round.id, bracket_match.round_id))
    .where(
      and(
        eq(bracket_match.stage_id, stageId),
        inArray(bracket_match.status, [Status.Ready, Status.Waiting]),
        isNull(bracket_match.lane_id),
        sql`${bracket_match.opponent1}->>'id' is not null`,
        sql`${bracket_match.opponent2}->>'id' is not null`
      )
    );

  const time = (v: string | null) => (v ? new Date(v).getTime() : 0);
  rows.sort((a, b) => {
    if (a.round_number !== b.round_number) return a.round_number - b.round_number;
    if (b.status !== a.status) return b.status - a.status;
    const byTime = time(a.updated_at) - time(b.updated_at);
    if (byTime !== 0) return byTime;
    if (a.number !== b.number) return a.number - b.number;
    return a.id - b.id;
  });

  return rows.map(({ id, round_id, number, status }) => ({ id, round_id, number, status }));
}

/**
 * Put a match on a lane. The caller holds the event lock and the lane row lock and has
 * checked the lane is idle. Returns false if the match already has a lane.
 */
export async function assignLane(ex: Executor, eventId: string, laneId: string, matchId: number): Promise<boolean> {
  const updated = await ex
    .update(bracket_match)
    .set({ lane_id: laneId, lane_assigned_at: sql`now()` })
    .where(and(eq(bracket_match.id, matchId), eq(bracket_match.event_id, eventId), isNull(bracket_match.lane_id)))
    .returning({ id: bracket_match.id });
  if (updated.length === 0) return false;

  await ex.update(lanes).set({ status: 'occupied' }).where(and(eq(lanes.id, laneId), eq(lanes.event_id, eventId)));
  return true;
}

/**
 * Take a match off its lane. A pending lane enters maintenance; otherwise it becomes
 * idle. Returns false only when `laneId` is given and the match is on a different lane;
 * true when there was nothing to release.
 */
export async function releaseMatchLane(
  ex: Executor,
  eventId: string,
  matchId: number,
  laneId?: string
): Promise<boolean> {
  const [match] = await ex
    .select({ lane_id: bracket_match.lane_id })
    .from(bracket_match)
    .where(and(eq(bracket_match.id, matchId), eq(bracket_match.event_id, eventId)));

  if (!match?.lane_id) return true;
  if (laneId && match.lane_id !== laneId) return false;

  await ex
    .update(bracket_match)
    .set({ lane_id: null, lane_assigned_at: null })
    .where(and(eq(bracket_match.id, matchId), eq(bracket_match.event_id, eventId)));
  await ex
    .update(lanes)
    .set({
      status: sql`case when ${lanes.maintenance_pending} then 'maintenance'::lane_status else 'idle'::lane_status end`,
      maintenance_pending: false,
    })
    .where(and(eq(lanes.id, match.lane_id), eq(lanes.event_id, eventId)));
  return true;
}

/**
 * Set a lane's state. Returns false if the lane isn't in the event.
 */
export async function setLaneState(
  ex: Executor,
  eventId: string,
  laneId: string,
  state: { status: 'idle' | 'occupied' | 'maintenance'; maintenance_pending: boolean }
): Promise<boolean> {
  const updated = await ex
    .update(lanes)
    .set(state)
    .where(and(eq(lanes.id, laneId), eq(lanes.event_id, eventId)))
    .returning({ id: lanes.id });
  return updated.length > 0;
}

/** Take every match off a lane after the caller has locked the relevant match rows and lanes. */
export async function clearLaneMatches(
  ex: Executor,
  eventId: string,
  laneId: string
): Promise<void> {
  await ex
    .update(bracket_match)
    .set({ lane_id: null, lane_assigned_at: null })
    .where(and(eq(bracket_match.lane_id, laneId), eq(bracket_match.event_id, eventId)));
}

export async function resetOccupiedLanesToIdle(ex: Executor, eventId: string): Promise<void> {
  await ex
    .update(lanes)
    .set({
      status: sql`case when ${lanes.maintenance_pending} then 'maintenance'::lane_status else 'idle'::lane_status end`,
      maintenance_pending: false,
    })
    .where(and(eq(lanes.event_id, eventId), eq(lanes.status, 'occupied')));
}
