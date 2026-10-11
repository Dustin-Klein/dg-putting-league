import 'server-only';
import { redirect } from 'next/navigation';
import { EventWithDetails, PayoutPlace } from '@/lib/types/event';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '@/lib/errors';
import { authorizeEventAdmin, authorizeEventView, authorizeLeagueAdmin } from '@/lib/services/auth';
import { normalizeAccessCode, ACCESS_CODE_MIN_LENGTH } from '@/lib/utils/access-code';
import { computePoolAssignments, PoolAssignment } from '@/lib/services/event-player';
import { computeTeamPairings } from '@/lib/services/team';
import {
  archiveGrandFinalResetMatchTx,
  createBracketTx,
  restoreGrandFinalResetMatchTx,
} from '@/lib/services/bracket';
import { autoAssignLanesTx } from '@/lib/services/lane';
import { lockEvent, withTransaction, type Executor, type Tx } from '@/lib/db/tx';
import * as eventDb from '@/lib/repositories/event-repository.db';
import * as eventPlayerDb from '@/lib/repositories/event-player-repository.db';
import * as teamDb from '@/lib/repositories/team-repository.db';
import * as laneDb from '@/lib/repositories/lane-repository.db';
import * as bracketDb from '@/lib/repositories/bracket-repository.db';
import * as eventPlacementDb from '@/lib/repositories/event-placement-repository.db';
import * as frameDb from '@/lib/repositories/frame-repository.db';
import { getDefaultPayoutStructure, calculatePayouts, PayoutBreakdown } from './payout-calculator';
import { logger } from '@/lib/utils/logger';
import { BRACKET_NOT_DECIDED_MESSAGE } from '@/lib/constants/event';
import {
  computeEventPlacements,
  isBracketDecided,
  type PlacementMatch,
  type PlacementOpponent,
} from './placements';
import {
  validatePreviewPayload,
  type ProvidedPoolAssignment,
  type ProvidedTeamPairing,
} from './preview';

/**
 * Ensure the current user is an admin of the event's league.
 * Returns the authenticated user and direct Postgres connection for this event.
 */
export async function requireEventAdmin(eventId: string) {
  const { user, pg } = await authorizeEventAdmin(eventId);
  return { pg, user };
}

/**
 * Get event with players (with redirect on missing eventId).
 * Admins of the event's league get admin-only fields (payment_type); public
 * viewers get the same fields the event SELECT policy exposed before this port.
 */
export async function getEventWithPlayers(eventId: string) {
  if (!eventId) {
    logger.warn('getEventWithPlayers called without an eventId');
    redirect('/admin/leagues');
  }

  const { pg, isAdmin } = await authorizeEventView(eventId, 'event');
  return eventDb.getEventWithPlayers(pg, eventId, { includePaymentType: isAdmin }) as Promise<EventWithDetails>;
}

/**
 * Get event with players for display. The access code is included only when the
 * current user is an admin of the event's league; otherwise it is null.
 */
export async function getEventForViewer(eventId: string): Promise<EventWithDetails> {
  const { pg, isAdmin } = await authorizeEventView(eventId, 'event');
  const event = await eventDb.getEventWithPlayers(pg, eventId, { includePaymentType: isAdmin }) as EventWithDetails;
  const accessCode = isAdmin ? await eventDb.getEventAccessCode(pg, eventId) : null;

  return { ...event, access_code: accessCode };
}

/**
 * Get events by league ID (with auth check)
 */
export async function getEventsByLeagueId(leagueId: string) {
  const { pg } = await authorizeLeagueAdmin(leagueId);
  return eventDb.getEventsByLeagueId(pg, leagueId);
}

/**
 * Create a new event with validation
 */
export async function createEvent(data: {
  league_id: string;
  event_date: string;
  location: string | null;
  lane_count: number;
  putt_distance_ft: number;
  access_code: string;
  qualification_round_enabled: boolean;
  bracket_frame_count: number;
  qualification_frame_count: number;
  double_grand_final?: boolean;
  entry_fee_per_player?: number | null;
  admin_fees?: number | null;
  admin_fee_per_player?: number | null;
  copy_players_from_event_id?: string;
}) {
  // 1. Auth check
  const { user, pg } = await authorizeLeagueAdmin(data.league_id);

  // 2. Normalize and check access code uniqueness (across all leagues)
  const accessCode = normalizeAccessCode(data.access_code);
  if (accessCode.length < ACCESS_CODE_MIN_LENGTH) {
    throw new BadRequestError(`Access code must be at least ${ACCESS_CODE_MIN_LENGTH} characters`);
  }
  const isUnique = await eventDb.isAccessCodeUnique(pg, accessCode);
  if (!isUnique) {
    throw new BadRequestError('An event with this access code already exists');
  }

  // 3. Format date — data.event_date is already YYYY-MM-DD from the form
  const formattedDate = data.event_date;

  const { copy_players_from_event_id, entry_fee_per_player, admin_fees, admin_fee_per_player, ...eventData } = data;

  let attemptedEventId: string | undefined;
  let newEvent: eventDb.EventData;
  try {
    newEvent = await withTransaction(pg, async (tx) => {
      if (copy_players_from_event_id) {
        const sourceLeagueId = await eventDb.getEventLeagueId(tx, copy_players_from_event_id);
        if (sourceLeagueId !== data.league_id) {
          throw new BadRequestError('Source event must belong to the same league');
        }
      }

      const created = await eventDb.createEvent(tx, {
        ...eventData,
        access_code: accessCode,
        event_date: formattedDate,
        entry_fee_per_player: entry_fee_per_player ?? null,
        admin_fees: admin_fees ?? null,
        admin_fee_per_player: admin_fee_per_player ?? null,
        status: 'created',
      });
      attemptedEventId = created.id;
      if (copy_players_from_event_id) {
        await eventDb.copyEventPlayers(tx, copy_players_from_event_id, created.id);
      }
      return created;
    });
  } catch (error) {
    logger.error('Event creation failed', {
      userId: user.id,
      action: 'create_event',
      eventId: attemptedEventId,
      leagueId: data.league_id,
      adminFees: admin_fees ?? null,
      entryFee: entry_fee_per_player ?? null,
      outcome: 'failure',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  logger.info('Event created successfully', {
    userId: user.id,
    action: 'create_event',
    eventId: newEvent.id,
    leagueId: data.league_id,
    adminFees: admin_fees ?? null,
    entryFee: entry_fee_per_player ?? null,
    outcome: 'success',
  });

  return newEvent;
}

/**
 * Delete an event and all related records, including hand-entered frames that only
 * reach the event through their results.
 */
export async function deleteEvent(eventId: string) {
  const { pg } = await requireEventAdmin(eventId);
  await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    const unlinkedFrameIds = await frameDb.getUnlinkedMatchFrameIdsForEvent(tx, eventId);
    await eventDb.deleteEvent(tx, eventId);
    await frameDb.deleteEmptyUnlinkedMatchFrames(tx, unlinkedFrameIds);
  });
}

/**
 * Validate event status transition and business rules
 */
export async function validateEventStatusTransition(
  eventId: string,
  newStatus: string,
  currentEvent: EventWithDetails,
  pg: Executor
) {
  const currentStatus = currentEvent.status;

  validateStatusFlow(currentStatus, newStatus);

  // Validation for pre-bracket to bracket transition
  if (currentStatus === 'pre-bracket' && newStatus === 'bracket') {
    if (currentEvent.players.length % 2 !== 0) {
      throw new BadRequestError(
        'An even number of players is required before starting bracket play'
      );
    }

    // Always check payment
    const unpaidPlayers = currentEvent.players.filter(
      (player) => player.payment_type === null
    );
    if (unpaidPlayers.length > 0) {
      throw new BadRequestError(
        'All players must be marked as paid before starting bracket play'
      );
    }

    // Additionally check qualification if enabled
    if (currentEvent.qualification_round_enabled) {
      const qualificationRound = await eventDb.getQualificationRound(pg, eventId);

      if (!qualificationRound) {
        throw new BadRequestError('No qualification round found for this event');
      }

      const frameCounts = await eventDb.getQualificationFrameCounts(pg, eventId);

      const incompletePlayers = currentEvent.players.filter(
        (player) => (frameCounts[player.id] || 0) < qualificationRound.frame_count
      );

      if (incompletePlayers.length > 0) {
        throw new BadRequestError(
          `All players must complete ${qualificationRound.frame_count} qualifying frames before starting bracket play`
        );
      }
    }
  }
}

function validateStatusFlow(currentStatus: string, newStatus: string): void {
  const statusFlow: Record<string, string[]> = {
    'created': ['pre-bracket'],
    'pre-bracket': ['bracket'],
    'bracket': ['completed'],
    'completed': []
  };

  if (!statusFlow[currentStatus]?.includes(newStatus)) {
    throw new BadRequestError(`Invalid status transition from ${currentStatus} to ${newStatus}`);
  }
}

export interface UpdateEventSettingsPatch {
  status?: 'created' | 'pre-bracket' | 'completed';
  double_grand_final?: boolean;
  force?: boolean;
}

/**
 * Authorize first, then atomically reconcile bracket settings, placements and status.
 */
export async function updateEventSettings(
  eventId: string,
  patch: UpdateEventSettingsPatch
) {
  const { pg } = await requireEventAdmin(eventId);
  const before = await eventDb.getEventWithPlayers(pg, eventId, { includePaymentType: true }) as EventWithDetails;

  if (patch.status) {
    await validateEventStatusTransition(eventId, patch.status, before, pg);
  }

  await withTransaction(pg, (tx) => updateEventSettingsTx(tx, eventId, patch));

  const updated = await eventDb.getEventById(pg, eventId);
  if (!updated) throw new NotFoundError('Event not found');
  return updated;
}

export async function updateEventSettingsTx(
  tx: Tx,
  eventId: string,
  patch: UpdateEventSettingsPatch
): Promise<void> {
  await lockEvent(tx, eventId);
  const current = await eventDb.getEventBracketConfig(tx, eventId, { lock: 'update' });
  if (!current) throw new NotFoundError('Event not found');

  if (patch.status) {
    validateStatusFlow(current.status, patch.status);
  }

  if (current.status === 'bracket' && patch.status === 'completed') {
    const context = await bracketDb.getBracketResetContext(tx, eventId);
    const participants = await bracketDb.getParticipantsForEvent(tx, eventId);
    const grandFinalGroup = context?.groups.find((group) => group.number === 3);
    const grandFinalRounds = new Map(
      (context?.rounds ?? [])
        .filter((round) => round.group_id === grandFinalGroup?.id)
        .map((round) => [round.id, round.number])
    );
    const grandFinalMatches = (context?.matches ?? [])
      .filter((match) => grandFinalRounds.has(match.round_id) && match.number === 1)
      .map((match) => ({
        roundNumber: grandFinalRounds.get(match.round_id) as number,
        status: match.status,
        opponent1: match.opponent1 as PlacementOpponent | null,
        opponent2: match.opponent2 as PlacementOpponent | null,
      }));

    const effectiveDoubleGrandFinal = patch.double_grand_final ?? current.double_grand_final;
    if (!patch.force && !isBracketDecided(grandFinalMatches, effectiveDoubleGrandFinal)) {
      throw new ConflictError(BRACKET_NOT_DECIDED_MESSAGE);
    }

    const matches: PlacementMatch[] = (context?.matches ?? []).map((match) => ({
      id: match.id,
      round_id: match.round_id,
      status: match.status,
      opponent1: match.opponent1 as PlacementOpponent | null,
      opponent2: match.opponent2 as PlacementOpponent | null,
    }));
    const placements = computeEventPlacements({
      eventId,
      groups: context?.groups ?? [],
      rounds: context?.rounds ?? [],
      matches,
      participants,
    });
    await eventPlacementDb.upsertEventPlacements(tx, placements);
  }

  if (patch.double_grand_final === false && current.double_grand_final) {
    await archiveGrandFinalResetMatchTx(tx, eventId);
  } else if (patch.double_grand_final === true && !current.double_grand_final) {
    await restoreGrandFinalResetMatchTx(tx, eventId);
  }

  await eventDb.updateEventSettings(tx, eventId, {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.double_grand_final !== undefined
      ? { double_grand_final: patch.double_grand_final }
      : {}),
  });
}

/**
 * Update an event
 */
export async function updateEvent(
  eventId: string,
  data: Record<string, unknown>
) {
  const { pg } = await requireEventAdmin(eventId);
  return eventDb.updateEvent(pg, eventId, data);
}

/**
 * Handle the transition from pre-bracket to bracket status, in one transaction:
 * pool assignments, teams, lanes, event status, bracket structure and initial lane
 * assignments all commit together or not at all.
 *
 * @param eventId - The event ID
 * @param event - The event with details
 * @param providedPoolAssignments - Optional pre-computed pool assignments (from preview)
 * @param providedTeamPairings - Optional pre-computed team pairings (from preview)
 */
export async function transitionEventToBracket(
  eventId: string,
  event: EventWithDetails,
  providedPoolAssignments?: ProvidedPoolAssignment[],
  providedTeamPairings?: ProvidedTeamPairing[]
) {
  const { pg } = await requireEventAdmin(eventId);

  await validateEventStatusTransition(eventId, 'bracket', event, pg);

  if ((providedPoolAssignments === undefined) !== (providedTeamPairings === undefined)) {
    throw new BadRequestError('Pool assignments and team pairings must be provided together');
  }

  // Use provided pairings if available, otherwise compute new ones
  const recomputedPoolAssignments = await computePoolAssignments(eventId, event);
  const poolAssignments = providedPoolAssignments ?? recomputedPoolAssignments;
  const teamPairings = providedTeamPairings ?? computeTeamPairings(recomputedPoolAssignments);

  await startBracket(pg, eventId, poolAssignments, teamPairings, recomputedPoolAssignments);
}

/**
 * Start bracket play for a pre-bracket event (the transactional part of
 * `transitionEventToBracket`). Callers authorize and validate first.
 */
export async function startBracket(
  pg: Executor,
  eventId: string,
  poolAssignments: ProvidedPoolAssignment[],
  teamPairings: ProvidedTeamPairing[],
  recomputedPoolAssignments?: PoolAssignment[]
): Promise<void> {
  const authoritativeAssignments = recomputedPoolAssignments ?? poolAssignments.map((assignment) => {
    if (
      assignment.playerId === undefined ||
      assignment.playerName === undefined ||
      assignment.pfaScore === undefined ||
      assignment.scoringMethod === undefined ||
      assignment.defaultPool === undefined
    ) {
      throw new BadRequestError('Server-computed player scores are required');
    }
    return {
      eventPlayerId: assignment.eventPlayerId,
      playerId: assignment.playerId,
      playerName: assignment.playerName,
      pool: assignment.pool,
      pfaScore: assignment.pfaScore,
      scoringMethod: assignment.scoringMethod,
      defaultPool: assignment.defaultPool,
    };
  });

  await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);

    const current = await eventDb.getEventBracketConfig(tx, eventId, { lock: 'update' });
    if (!current) {
      throw new NotFoundError('Event not found');
    }
    if (current.status !== 'pre-bracket') {
      throw new BadRequestError(`Event must be in pre-bracket status to start bracket play (current status: ${current.status})`);
    }

    const eventPlayerIds = await eventPlayerDb.getEventPlayerIds(tx, eventId);
    const validated = validatePreviewPayload({
      currentEventPlayerIds: eventPlayerIds,
      recomputedPoolAssignments: authoritativeAssignments,
      providedPoolAssignments: poolAssignments,
      providedTeamPairings: teamPairings,
    });

    await eventPlayerDb.applyPoolAssignments(
      tx,
      eventId,
      validated.poolAssignments.map((pa) => ({
        event_player_id: pa.eventPlayerId,
        pool: pa.pool,
        pfa_score: pa.pfaScore,
        scoring_method: pa.scoringMethod,
      }))
    );

    await teamDb.insertTeamsWithMembers(
      tx,
      eventId,
      validated.teamPairings.map((tp) => ({
        seed: tp.seed,
        pool_combo: tp.poolCombo,
        members: tp.members.map((m) => ({ event_player_id: m.eventPlayerId, role: m.role, slot: m.slot })),
      }))
    );

    if (current.lane_count > 0 && !(await laneDb.hasLanes(tx, eventId))) {
      await laneDb.insertLanes(tx, eventId, current.lane_count);
    }

    await eventDb.setEventStatus(tx, eventId, 'bracket');
    await createBracketTx(tx, eventId, current.double_grand_final);
    await autoAssignLanesTx(tx, eventId);
  });
}

export interface EventPayoutInfo {
  entry_fee_per_player: number;
  admin_fees: number;
  admin_fee_per_player: number;
  payout_pool_override: number | null;
  player_count: number;
  team_count: number;
  total_pot: number;
  structure: PayoutPlace[];
  payouts: PayoutBreakdown[];
  is_custom: boolean;
}

/**
 * Get computed payout breakdown for an event
 */
export async function getEventPayouts(eventId: string): Promise<EventPayoutInfo | null> {
  const event = await getEventWithPlayers(eventId);

  if (event.entry_fee_per_player == null) {
    return null;
  }

  const entryFee = Number(event.entry_fee_per_player);
  const adminFees = Number(event.admin_fees ?? 0);
  const adminFeePerPlayer = Number(event.admin_fee_per_player ?? 0);
  const payoutPoolOverride = event.payout_pool_override != null ? Number(event.payout_pool_override) : null;
  const playerCount = event.players?.length ?? 0;
  const teamCount = event.teams?.length ?? 0;
  const totalPot = entryFee * playerCount;

  const isCustom = event.payout_structure !== null;
  const structure: PayoutPlace[] = isCustom
    ? (event.payout_structure as PayoutPlace[])
    : getDefaultPayoutStructure(teamCount);

  const payouts = calculatePayouts(entryFee, playerCount, structure, adminFees, adminFeePerPlayer, payoutPoolOverride);

  return {
    entry_fee_per_player: entryFee,
    admin_fees: adminFees,
    admin_fee_per_player: adminFeePerPlayer,
    payout_pool_override: payoutPoolOverride,
    player_count: playerCount,
    team_count: teamCount,
    total_pot: totalPot,
    structure,
    payouts,
    is_custom: isCustom,
  };
}

/**
 * Update payout structure for an event (admin only, bracket status)
 */
export async function updateEventPayouts(
  eventId: string,
  payoutStructure: PayoutPlace[] | null,
  payoutPoolOverride?: number | null
): Promise<void> {
  const { pg } = await requireEventAdmin(eventId);

  const event = await eventDb.getEventById(pg, eventId);
  if (!event) {
    throw new BadRequestError('Event not found');
  }

  if (event.status !== 'bracket') {
    throw new BadRequestError('Payout structure can only be edited during bracket play');
  }

  if (payoutStructure !== null) {
    const sum = payoutStructure.reduce((acc, p) => acc + p.percentage, 0);
    if (Math.abs(sum - 100) > 0.01) {
      throw new BadRequestError('Payout percentages must sum to 100');
    }

    for (let i = 0; i < payoutStructure.length; i++) {
      if (payoutStructure[i].place !== i + 1) {
        throw new BadRequestError('Places must be sequential starting from 1');
      }
    }
  }

  await eventDb.updateEventPayouts(pg, eventId, payoutStructure, payoutPoolOverride);
}
