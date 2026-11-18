import 'server-only';
import { authorizeEventAdmin } from '@/lib/services/auth';
import { lockEvents, withTransaction, type Executor, type Tx } from '@/lib/db/tx';
import * as laneDb from '@/lib/repositories/lane-repository.db';
import * as eventDb from '@/lib/repositories/event-repository.db';
import { lockMatchesOnLanes } from '@/lib/repositories/lane-repository.db';
import { BadRequestError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/utils/logger';
import type { LaneLoans } from '@/lib/types/bracket';
import type { EventStatus } from '@/lib/types/event';
import { autoAssignLanesTx } from './lane-service';

/** The main event and its second chance, from either side; null if `eventId` has neither. */
async function loanPair(ex: Executor, eventId: string): Promise<{ parentId: string; childId: string } | null> {
  const link = await eventDb.getEventLink(ex, eventId);
  if (!link) throw new NotFoundError('Event not found');
  if (link.link_type === 'second_chance' && link.parent_event_id) {
    return { parentId: link.parent_event_id, childId: eventId };
  }
  const child = await eventDb.getSecondChanceChild(ex, eventId);
  return child ? { parentId: eventId, childId: child.id } : null;
}

export async function getLaneLoans(eventId: string): Promise<LaneLoans> {
  const { pg } = await authorizeEventAdmin(eventId);
  const pair = await loanPair(pg, eventId);
  if (!pair) return { role: null, partner_event_id: null, lanes: [], can_lend: false };

  if (pair.parentId === eventId) {
    const [child, lent] = await Promise.all([
      eventDb.getEventLink(pg, pair.childId),
      laneDb.getLanesLentOut(pg, eventId),
    ]);
    return {
      role: 'main',
      partner_event_id: pair.childId,
      lanes: lent.map(({ id, label, status, after_match }) => ({ id, label, status, after_match })),
      can_lend: child !== null && child.status !== 'completed',
    };
  }
  const borrowed = await laneDb.getLanesForEvent(pg, eventId);
  return {
    role: 'second_chance',
    partner_event_id: pair.parentId,
    lanes: borrowed.map(({ id, label, status }) => ({ id, label, status, after_match: false })),
    can_lend: false,
  };
}

/** Lock both events (id order) and their rows; returns their statuses. */
async function lockPair(tx: Tx, pair: { parentId: string; childId: string }) {
  await lockEvents(tx, [pair.parentId, pair.childId]);
  const [parent, child] = await Promise.all([
    eventDb.getEventBracketConfig(tx, pair.parentId, { lock: 'share' }),
    eventDb.getEventBracketConfig(tx, pair.childId, { lock: 'share' }),
  ]);
  if (!parent || !child) throw new NotFoundError('Event not found');
  return { parent, child };
}

/**
 * Lend lanes of a main event to its second chance, inside the caller's transaction,
 * which holds both event locks and rows. An idle lane moves now; a lane with a
 * main-event match on it moves once that match leaves it, and gets no other main-event
 * match meanwhile. The second chance's next matches are called to the lanes it gets.
 */
export async function lendLanesTx(
  tx: Tx,
  pair: { parentId: string; childId: string },
  childStatus: EventStatus,
  requestedLaneIds: string[]
): Promise<void> {
  const laneIds = [...new Set(requestedLaneIds)];
  if (laneIds.length === 0) return;
  if (childStatus === 'completed') throw new BadRequestError('The second chance is already completed');

  const owned = await laneDb.lockOwnedLanes(tx, pair.parentId, laneIds);
  if (owned.length !== laneIds.length) throw new NotFoundError('Lane not found');
  const inUse = new Set(await laneDb.getLanesInUseBy(tx, pair.parentId, laneIds));
  for (const lane of owned) {
    if (lane.to_event_id) throw new BadRequestError(`${lane.label} is already lent out`);
    if (lane.status === 'maintenance' || lane.maintenance_pending) {
      throw new BadRequestError(`${lane.label} is in maintenance; bring it back before lending it`);
    }
    if (lane.status === 'occupied' && !inUse.has(lane.id)) {
      throw new BadRequestError(`${lane.label} is busy; try again in a moment`);
    }
  }

  await laneDb.insertLaneLoans(tx, pair.parentId, pair.childId, laneIds);
  await laneDb.touchLanes(tx, laneIds);
  if (childStatus === 'bracket') await autoAssignLanesTx(tx, pair.childId);
}

/** Lend lanes to the second chance (see `lendLanesTx`). */
export async function lendLanes(eventId: string, laneIds: string[]): Promise<void> {
  const { pg, user } = await authorizeEventAdmin(eventId);
  const pair = await loanPair(pg, eventId);
  if (!pair || pair.parentId !== eventId) {
    throw new BadRequestError('Only a main event with a second chance can lend lanes');
  }

  await withTransaction(pg, async (tx) => {
    const { child } = await lockPair(tx, pair);
    await lendLanesTx(tx, pair, child.status, laneIds);
  });

  logger.info('Lanes lent to second chance', {
    userId: user.id, action: 'lend_lanes', eventId, secondChanceEventId: pair.childId, laneIds, outcome: 'success',
  });
}

/**
 * Give lent lanes back to the main event, from either side. A lane with a
 * second-chance match on it stays lent until that match is done or moved; one still
 * waiting for its main-event match to finish just stays with the main event.
 */
export async function returnLanes(eventId: string, requestedLaneIds: string[]): Promise<void> {
  const { pg, user } = await authorizeEventAdmin(eventId);
  const laneIds = [...new Set(requestedLaneIds)];
  const pair = await loanPair(pg, eventId);
  if (!pair) throw new BadRequestError('This event has no lanes lent or borrowed');

  await withTransaction(pg, async (tx) => {
    const { parent } = await lockPair(tx, pair);
    const owned = await laneDb.lockOwnedLanes(tx, pair.parentId, laneIds);
    if (owned.length !== laneIds.length) throw new NotFoundError('Lane not found');
    const inUse = new Set(await laneDb.getLanesInUseBy(tx, pair.childId, laneIds));
    for (const lane of owned) {
      if (lane.to_event_id !== pair.childId) throw new BadRequestError(`${lane.label} is not lent to the second chance`);
      if (inUse.has(lane.id)) {
        throw new BadRequestError(`${lane.label} has a second-chance match on it; return it once that match is done`);
      }
    }

    await laneDb.endLaneLoans(tx, laneIds);
    if (parent.status === 'bracket') await autoAssignLanesTx(tx, pair.parentId);
  });

  logger.info('Lanes returned to main event', {
    userId: user.id, action: 'return_lanes', eventId, mainEventId: pair.parentId, laneIds, outcome: 'success',
  });
}

/**
 * Give every lane lent to `childId` back to `parentId`, taking any second-chance match
 * off it first (a forced completion or a deletion can leave one there). The caller
 * holds both event locks.
 */
export async function returnAllLanesTx(tx: Tx, parentId: string, childId: string): Promise<void> {
  const laneIds = await laneDb.getLaneIdsLentTo(tx, childId);
  if (laneIds.length === 0) return;

  // Lock order: match rows before lane rows.
  await lockMatchesOnLanes(tx, childId, laneIds);
  await laneDb.lockOwnedLanes(tx, parentId, laneIds);
  for (const laneId of laneIds) await laneDb.clearLaneMatches(tx, childId, laneId);
  await laneDb.endLaneLoans(tx, laneIds);

  const parent = await eventDb.getEventBracketConfig(tx, parentId);
  if (parent?.status === 'bracket') await autoAssignLanesTx(tx, parentId);
}
