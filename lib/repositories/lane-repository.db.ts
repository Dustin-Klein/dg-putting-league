import 'server-only';
import { and, asc, eq, inArray, isNotNull, isNull, not, sql } from 'drizzle-orm';
import { Status } from 'brackets-model';
import type { Executor, Tx } from '@/lib/db/tx';
import { bracket_match, bracket_round, lane_loans, lanes } from '@/lib/db/schema';
import { compareMatchQueue } from '@/lib/utils/match-queue';
import type { Lane } from '@/lib/types/bracket';

/** The lane still has a match of its owner on it. */
const ownerMatchOnLane = sql`exists (
  select 1 from ${bracket_match}
  where ${bracket_match.lane_id} = ${lanes.id} and ${bracket_match.event_id} = ${lanes.event_id}
)`;

/**
 * Lanes an event plays on: its own lanes that aren't lent out, plus lanes lent to it.
 * A lane lent while its owner's match was on it stays the owner's until that match
 * leaves it, then passes to the borrower. Ownership (lanes.event_id) never changes;
 * numbering, adding and deleting go by it.
 */
function usableBy(eventId: string) {
  return sql`(
    (${lanes.event_id} = ${eventId}
      and (not exists (select 1 from ${lane_loans} where ${lane_loans.lane_id} = ${lanes.id}) or ${ownerMatchOnLane}))
    or (exists (
      select 1 from ${lane_loans}
      where ${lane_loans.lane_id} = ${lanes.id} and ${lane_loans.to_event_id} = ${eventId}
    ) and not ${ownerMatchOnLane})
  )`;
}

/**
 * Lanes whose state an event may reset: those it uses, plus its own lanes lent out
 * with no borrower match on them (the owner's last match just left a lane lent after it).
 */
function freeableBy(eventId: string) {
  return sql`(
    ${usableBy(eventId)}
    or (${lanes.event_id} = ${eventId} and not exists (
      select 1 from ${bracket_match}
      join ${lane_loans} on ${lane_loans.lane_id} = ${bracket_match.lane_id}
      where ${bracket_match.lane_id} = ${lanes.id} and ${bracket_match.event_id} = ${lane_loans.to_event_id}
    ))
  )`;
}

/**
 * Lock all of an event's lanes (ascending id, per the lock order) and return them.
 */
export async function lockEventLanes(tx: Tx, eventId: string): Promise<Lane[]> {
  const rows = await tx
    .select()
    .from(lanes)
    .where(usableBy(eventId))
    .orderBy(asc(lanes.id))
    .for('update');
  return rows as Lane[];
}

export async function hasLanes(ex: Executor, eventId: string): Promise<boolean> {
  const rows = await ex.select({ id: lanes.id }).from(lanes).where(eq(lanes.event_id, eventId)).limit(1);
  return rows.length > 0;
}

export async function getLanesForEvent(ex: Executor, eventId: string): Promise<Lane[]> {
  return ex.select().from(lanes).where(usableBy(eventId)).orderBy(asc(lanes.label)) as Promise<Lane[]>;
}

export async function getLaneById(ex: Executor, eventId: string, laneId: string): Promise<Lane | null> {
  const [lane] = await ex
    .select()
    .from(lanes)
    .where(and(eq(lanes.id, laneId), usableBy(eventId)));
  return (lane as Lane | undefined) ?? null;
}

export async function getLaneLabelsForEvent(ex: Executor, eventId: string): Promise<Record<string, string>> {
  const rows = await ex.select({ id: lanes.id, label: lanes.label }).from(lanes).where(usableBy(eventId));
  return Object.fromEntries(rows.map((lane) => [lane.id, lane.label]));
}

export async function getMatchLaneAssignments(
  ex: Executor,
  eventId: string
): Promise<Record<string, { id: number; number: number; status: number }>> {
  const rows = await ex
    .select({ id: bracket_match.id, number: bracket_match.number, status: bracket_match.status, lane_id: bracket_match.lane_id })
    .from(bracket_match)
    .where(and(eq(bracket_match.event_id, eventId), isNotNull(bracket_match.lane_id)));
  return Object.fromEntries(
    rows.flatMap((match) => match.lane_id ? [[match.lane_id, { id: match.id, number: match.number, status: match.status }]] : [])
  );
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

export async function insertLanes(ex: Executor, eventId: string, count: number): Promise<Lane[]> {
  if (count <= 0) return [];
  return ex.insert(lanes).values(
    Array.from({ length: count }, (_, i) => ({ event_id: eventId, label: `Lane ${i + 1}`, status: 'idle' as const }))
  ).returning() as Promise<Lane[]>;
}

export async function addLanesToEvent(ex: Executor, eventId: string, count: number): Promise<Lane[]> {
  // Owned lanes, lent ones included: a lent "Lane 7" must not be created again.
  const existing = await ex.select({ label: lanes.label }).from(lanes).where(eq(lanes.event_id, eventId));
  let maxNumber = 0;
  for (const lane of existing) {
    const match = /^Lane (\d+)$/.exec(lane.label);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]));
  }
  if (count <= 0) return [];
  return ex.insert(lanes).values(
    Array.from({ length: count }, (_, index) => ({
      event_id: eventId,
      label: `Lane ${maxNumber + index + 1}`,
      status: 'idle' as const,
    }))
  ).returning() as Promise<Lane[]>;
}

/** Lock the event's matches on any of the given lanes (ascending id), before the lane rows. */
export async function lockMatchesOnLanes(tx: Tx, eventId: string, laneIds: string[]): Promise<void> {
  if (laneIds.length === 0) return;
  await tx
    .select({ id: bracket_match.id })
    .from(bracket_match)
    .where(and(eq(bracket_match.event_id, eventId), inArray(bracket_match.lane_id, laneIds)))
    .orderBy(asc(bracket_match.id))
    .for('update');
}

/** Lock assigned matches before lane rows, in documented order. */
export async function lockMatchesAssignedToLane(tx: Tx, eventId: string, laneId: string): Promise<Array<{ id: number }>> {
  return tx
    .select({ id: bracket_match.id })
    .from(bracket_match)
    .where(and(eq(bracket_match.event_id, eventId), eq(bracket_match.lane_id, laneId)))
    .orderBy(asc(bracket_match.id))
    .for('update');
}

/** Caller holds event, relevant match, and lane locks. */
export async function deleteIdleLane(ex: Executor, eventId: string, laneId: string): Promise<boolean> {
  const assigned = await getMatchAssignedToLane(ex, eventId, laneId);
  if (assigned) return false;
  const deleted = await ex
    .delete(lanes)
    .where(and(eq(lanes.id, laneId), eq(lanes.event_id, eventId), usableBy(eventId), eq(lanes.status, 'idle')))
    .returning({ id: lanes.id });
  return deleted.length > 0;
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

  rows.sort(compareMatchQueue);

  return rows.map(({ id, round_id, number, status }) => ({ id, round_id, number, status }));
}

/**
 * Put a match on a lane. The caller holds the event lock and the lane row lock and has
 * checked the lane is idle. Returns false if the match already has a lane.
 */
export async function assignLane(ex: Executor, eventId: string, laneId: string, matchId: number): Promise<boolean> {
  return (await assignLanes(ex, eventId, [{ laneId, matchId }])).length > 0;
}

/**
 * Put each match on its paired lane: one UPDATE for the matches and one for the lanes.
 * The caller holds the event lock and the lane row locks and has checked the lanes are
 * idle; pairs must use distinct lanes and matches. A match that already has a lane is
 * skipped and its lane stays as it was. Returns the pairs that were assigned.
 */
export async function assignLanes(
  ex: Executor,
  eventId: string,
  pairs: Array<{ laneId: string; matchId: number }>
): Promise<Array<{ laneId: string; matchId: number }>> {
  if (pairs.length === 0) return [];
  const values = sql.join(pairs.map((p) => sql`(${p.matchId}::integer, ${p.laneId}::uuid)`), sql`, `);
  const assigned = await ex.execute<{ match_id: number; lane_id: string }>(sql`
    update ${bracket_match} as m
    set lane_id = v.lane_id, lane_assigned_at = now()
    from (values ${values}) as v(match_id, lane_id)
    where m.id = v.match_id and m.event_id = ${eventId} and m.lane_id is null
    returning m.id as match_id, m.lane_id`);
  if (assigned.length === 0) return [];

  await ex
    .update(lanes)
    .set({ status: 'occupied' })
    .where(and(usableBy(eventId), inArray(lanes.id, assigned.map((row) => row.lane_id))));
  return assigned.map((row) => ({ laneId: row.lane_id, matchId: row.match_id }));
}

/**
 * Take the given matches off their lanes in one statement. Each freed lane enters
 * maintenance if it was pending, otherwise becomes idle. Caller holds the event lock.
 */
export async function releaseMatchLanes(ex: Executor, eventId: string, matchIds: number[]): Promise<void> {
  if (matchIds.length === 0) return;
  const ids = sql.join(matchIds.map((id) => sql`${id}::integer`), sql`, `);
  await ex.execute(sql`
    with released as (
      update ${bracket_match} as m
      set lane_id = null, lane_assigned_at = null
      from (
        select id, lane_id from ${bracket_match}
        where event_id = ${eventId} and id in (${ids}) and lane_id is not null
      ) as previous
      where m.id = previous.id
      returning previous.lane_id
    )
    update ${lanes}
    set status = case when maintenance_pending then 'maintenance'::putting_league.lane_status else 'idle'::putting_league.lane_status end,
        maintenance_pending = false
    where ${freeableBy(eventId)} and id in (select lane_id from released)`);
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
      status: sql`case when ${lanes.maintenance_pending} then 'maintenance'::putting_league.lane_status else 'idle'::putting_league.lane_status end`,
      maintenance_pending: false,
    })
    .where(and(eq(lanes.id, match.lane_id), freeableBy(eventId)));
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
    .where(and(eq(lanes.id, laneId), freeableBy(eventId)))
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
      status: sql`case when ${lanes.maintenance_pending} then 'maintenance'::putting_league.lane_status else 'idle'::putting_league.lane_status end`,
      maintenance_pending: false,
    })
    .where(and(freeableBy(eventId), eq(lanes.status, 'occupied')));
}

export interface LentLane {
  id: string;
  label: string;
  status: Lane['status'];
  to_event_id: string;
  /** Lent, but the owner's match is still on it. */
  after_match: boolean;
}

/** The event's own lanes that are lent out, with who has them. */
export async function getLanesLentOut(ex: Executor, eventId: string): Promise<LentLane[]> {
  return ex
    .select({
      id: lanes.id,
      label: lanes.label,
      status: lanes.status,
      to_event_id: lane_loans.to_event_id,
      after_match: sql<boolean>`${ownerMatchOnLane}`,
    })
    .from(lanes)
    .innerJoin(lane_loans, eq(lane_loans.lane_id, lanes.id))
    .where(eq(lanes.event_id, eventId))
    .orderBy(asc(lanes.label));
}

/** Lock the given lanes owned by `ownerEventId` (ascending id), with their loan if any. */
export async function lockOwnedLanes(
  tx: Tx,
  ownerEventId: string,
  laneIds: string[]
): Promise<Array<Lane & { to_event_id: string | null }>> {
  if (laneIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(lanes)
    .where(and(eq(lanes.event_id, ownerEventId), inArray(lanes.id, laneIds)))
    .orderBy(asc(lanes.id))
    .for('update');
  const loans = await tx
    .select({ lane_id: lane_loans.lane_id, to_event_id: lane_loans.to_event_id })
    .from(lane_loans)
    .where(inArray(lane_loans.lane_id, laneIds));
  const loanByLane = new Map(loans.map((loan) => [loan.lane_id, loan.to_event_id]));
  return rows.map((row) => ({ ...(row as Lane), to_event_id: loanByLane.get(row.id) ?? null }));
}

/** Lanes with a match of `eventId` on them, of the given lanes. */
export async function getLanesInUseBy(ex: Executor, eventId: string, laneIds: string[]): Promise<string[]> {
  if (laneIds.length === 0) return [];
  const rows = await ex
    .selectDistinct({ lane_id: bracket_match.lane_id })
    .from(bracket_match)
    .where(and(eq(bracket_match.event_id, eventId), inArray(bracket_match.lane_id, laneIds)));
  return rows.flatMap((row) => (row.lane_id ? [row.lane_id] : []));
}

export async function insertLaneLoans(
  ex: Executor,
  fromEventId: string,
  toEventId: string,
  laneIds: string[]
): Promise<void> {
  if (laneIds.length === 0) return;
  await ex.insert(lane_loans).values(laneIds.map((laneId) => ({
    lane_id: laneId,
    from_event_id: fromEventId,
    to_event_id: toEventId,
  })));
}

/**
 * End the given loans: the lanes go back to their owner idle (or into maintenance if
 * that was pending), except one the owner's match is still on, which stays as it is.
 * Callers have taken the borrower's matches off them.
 */
export async function endLaneLoans(ex: Executor, laneIds: string[]): Promise<void> {
  if (laneIds.length === 0) return;
  await ex.delete(lane_loans).where(inArray(lane_loans.lane_id, laneIds));
  // Also the realtime signal for the owner's lane subscription, which filters on event_id.
  await ex
    .update(lanes)
    .set({
      status: sql`case when ${lanes.status} = 'maintenance' or ${lanes.maintenance_pending} then 'maintenance'::putting_league.lane_status else 'idle'::putting_league.lane_status end`,
      maintenance_pending: false,
    })
    .where(and(inArray(lanes.id, laneIds), not(ownerMatchOnLane)));
}

/** Lane ids lent to `eventId`. */
export async function getLaneIdsLentTo(ex: Executor, eventId: string): Promise<string[]> {
  const rows = await ex.select({ lane_id: lane_loans.lane_id }).from(lane_loans)
    .where(eq(lane_loans.to_event_id, eventId)).orderBy(asc(lane_loans.lane_id));
  return rows.map((row) => row.lane_id);
}

/** Events with an idle lane lent to them by `ownerEventId`, in id order. */
export async function getBorrowersWithIdleLentLanes(ex: Executor, ownerEventId: string): Promise<string[]> {
  const rows = await ex
    .selectDistinct({ to_event_id: lane_loans.to_event_id })
    .from(lane_loans)
    .innerJoin(lanes, eq(lanes.id, lane_loans.lane_id))
    .where(and(eq(lane_loans.from_event_id, ownerEventId), eq(lanes.status, 'idle')))
    .orderBy(asc(lane_loans.to_event_id));
  return rows.map((row) => row.to_event_id);
}

/** Touch lanes so the owner's realtime lane subscription (filtered on event_id) fires. */
export async function touchLanes(ex: Executor, laneIds: string[]): Promise<void> {
  if (laneIds.length === 0) return;
  await ex.update(lanes).set({ status: sql`${lanes.status}` }).where(inArray(lanes.id, laneIds));
}

/** Labels of the lanes currently lent to each event, in label order. */
export async function getBorrowedLaneLabels(ex: Executor, eventIds: readonly string[]): Promise<Map<string, string[]>> {
  const byEvent = new Map<string, string[]>();
  if (eventIds.length === 0) return byEvent;
  const rows = await ex
    .select({ event_id: lane_loans.to_event_id, label: lanes.label })
    .from(lane_loans)
    .innerJoin(lanes, eq(lanes.id, lane_loans.lane_id))
    .where(inArray(lane_loans.to_event_id, [...eventIds]));
  rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  for (const row of rows) byEvent.set(row.event_id, [...(byEvent.get(row.event_id) ?? []), row.label]);
  return byEvent;
}
