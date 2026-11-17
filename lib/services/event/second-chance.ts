import 'server-only';
import { authorizeEventAdmin } from '@/lib/services/auth';
import { computePfaScores } from '@/lib/services/event-player';
import { refreshEntrySnapshots } from '@/lib/services/handicap/snapshot';
import { lockEvents, withTransaction, type Executor } from '@/lib/db/tx';
import * as eventDb from '@/lib/repositories/event-repository.db';
import * as eventPlayerDb from '@/lib/repositories/event-player-repository.db';
import * as eventPlacementDb from '@/lib/repositories/event-placement-repository.db';
import * as bracketDb from '@/lib/repositories/bracket-repository.db';
import * as teamDb from '@/lib/repositories/team-repository.db';
import * as playerDb from '@/lib/repositories/player-repository.db';
import { stageFormat } from '@/lib/brackets/format';
import { decidedMatchesOf, type PlacementOpponent } from '@/lib/brackets/placements';
import { eliminatedTeamIds } from '@/lib/brackets/elimination';
import { BadRequestError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/utils/logger';
import type { EventStatus, SecondChancePlayer, SecondChanceRoster, SecondChanceSummary } from '@/lib/types/event';
import { selectSecondChancePlayers } from './linked-events';

/**
 * Players eligible for `parent`'s second chance right now: everyone knocked out of its
 * bracket so far (once completed, everyone but the winners). Hold the parent's event lock for a stable answer.
 */
export async function eligibleSecondChancePlayerIds(
  ex: Executor,
  parent: { id: string; status: EventStatus }
): Promise<string[]> {
  if (parent.status === 'completed') {
    return selectSecondChancePlayers(await eventPlacementDb.getPlacedPlayers(ex, parent.id));
  }
  if (parent.status !== 'bracket') return [];

  const [context, participants, config] = await Promise.all([
    bracketDb.getBracketResetContext(ex, parent.id),
    bracketDb.getParticipantsForEvent(ex, parent.id),
    eventDb.getEventBracketConfig(ex, parent.id),
  ]);
  if (!context || !config) return [];
  const decided = decidedMatchesOf({
    groups: context.groups,
    rounds: context.rounds,
    matches: context.matches.map((match) => ({
      id: match.id,
      round_id: match.round_id,
      status: match.status,
      opponent1: match.opponent1 as PlacementOpponent | null,
      opponent2: match.opponent2 as PlacementOpponent | null,
    })),
    participants,
  });
  const teamIds = eliminatedTeamIds(stageFormat(context.stage.type), config.double_grand_final, decided);
  return teamDb.getPlayerIdsOfTeams(ex, parent.id, [...teamIds]);
}

/** The main event's second-chance state, for its admin page. */
export async function getSecondChanceSummary(parentEventId: string): Promise<SecondChanceSummary> {
  const { pg } = await authorizeEventAdmin(parentEventId);
  const link = await eventDb.getEventLink(pg, parentEventId);
  if (!link) throw new NotFoundError('Event not found');
  if (link.parent_event_id !== null) {
    return { status: link.status, eliminated_count: 0, child: null, can_create: false };
  }

  const [child, eligible] = await Promise.all([
    eventDb.getSecondChanceChild(pg, parentEventId),
    eligibleSecondChancePlayerIds(pg, link),
  ]);
  return {
    status: link.status,
    eliminated_count: eligible.length,
    child,
    can_create: child === null && (link.status === 'bracket' || link.status === 'completed'),
  };
}

async function requireSecondChanceLink(ex: Executor, eventId: string) {
  const link = await eventDb.getEventLink(ex, eventId);
  if (!link) throw new NotFoundError('Event not found');
  if (link.link_type !== 'second_chance' || link.parent_event_id === null) {
    throw new BadRequestError('This is not a second-chance event');
  }
  return { ...link, parent_event_id: link.parent_event_id };
}

async function withNames(ex: Executor, playerIds: string[]): Promise<SecondChancePlayer[]> {
  const names = await playerDb.getPlayerNames(ex, playerIds);
  return names.sort((a, b) => a.full_name.localeCompare(b.full_name));
}

async function rosterOf(
  ex: Executor,
  child: { id: string; status: EventStatus; parent_event_id: string }
): Promise<SecondChanceRoster> {
  const parent = await eventDb.getEventLink(ex, child.parent_event_id);
  if (!parent) throw new NotFoundError('Main event not found');
  const [eligible, entered, inMainEvent] = await Promise.all([
    eligibleSecondChancePlayerIds(ex, parent),
    playerDb.getPlayerIdsInEvent(ex, child.id),
    playerDb.getPlayerIdsInEvent(ex, parent.id),
  ]);
  const eligibleSet = new Set(eligible);
  const enteredSet = new Set(entered);
  const mainEventSet = new Set(inMainEvent);
  const canSync = child.status === 'created' || child.status === 'pre-bracket';
  return {
    parent_event_id: parent.id,
    parent_status: parent.status,
    status: child.status,
    pending: canSync ? await withNames(ex, eligible.filter((id) => !enteredSet.has(id))) : [],
    not_eliminated: canSync ? await withNames(ex, entered.filter((id) => mainEventSet.has(id) && !eligibleSet.has(id))) : [],
    can_sync: canSync,
  };
}

/** Who is out of the main event but not entered here, and the reverse. */
export async function getSecondChanceRoster(eventId: string): Promise<SecondChanceRoster> {
  const { pg } = await authorizeEventAdmin(eventId);
  return rosterOf(pg, await requireSecondChanceLink(pg, eventId));
}

/**
 * Enter every player knocked out of the main event since the last sync. Never removes
 * anyone: a player who is no longer out of the main event is only reported, for the
 * organizer to remove. Seeding scores are recomputed for everyone when the bracket starts.
 */
export async function syncSecondChancePlayers(
  eventId: string
): Promise<SecondChanceRoster & { added: number }> {
  const { pg, user } = await authorizeEventAdmin(eventId);
  // parent_event_id never changes, so it is safe to read before taking the locks.
  const { parent_event_id: parentEventId } = await requireSecondChanceLink(pg, eventId);

  const { roster, added } = await withTransaction(pg, async (tx) => {
    // Both event locks, in id order: holding the parent's freezes its bracket results.
    await lockEvents(tx, [parentEventId, eventId]);
    const child = await eventDb.getEventLink(tx, eventId, { lock: 'update' });
    const parent = await eventDb.getEventLink(tx, parentEventId);
    const event = await eventDb.getEventById(tx, eventId);
    if (!child || !parent || !event) throw new NotFoundError('Event not found');
    if (child.status !== 'created' && child.status !== 'pre-bracket') {
      throw new BadRequestError('Players can only be added before the second-chance bracket starts');
    }

    const entered = new Set(await playerDb.getPlayerIdsInEvent(tx, eventId));
    const eligible = await eligibleSecondChancePlayerIds(tx, parent);
    const newPlayerIds = eligible.filter((id) => !entered.has(id));
    if (newPlayerIds.length > 0) {
      const pfaScores = await computePfaScores(tx, newPlayerIds);
      await eventPlayerDb.insertScoredEventPlayers(tx, eventId, newPlayerIds.map((playerId) => {
        const { score, scoringMethod } = pfaScores.get(playerId)!;
        return { player_id: playerId, pfa_score: score, scoring_method: scoringMethod };
      }), event.putt_distance_ft);
      // Last: it takes the league handicap lock.
      await refreshEntrySnapshots(tx, eventId);
    }
    return {
      roster: await rosterOf(tx, { ...child, parent_event_id: parentEventId }),
      added: newPlayerIds.length,
    };
  });

  logger.info('Second-chance players synced', {
    userId: user.id,
    action: 'sync_second_chance_players',
    eventId,
    parentEventId,
    added,
    outcome: 'success',
  });
  return { ...roster, added };
}
