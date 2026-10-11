import 'server-only';
import { redirect } from 'next/navigation';
import { EventWithDetails, PayoutPlace, type TeamAssignment } from '@/lib/types/event';
import type { TeamPreview } from '@/lib/types/team';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '@/lib/errors';
import { authorizeEventAdmin, authorizeEventView, authorizeLeagueAdmin } from '@/lib/services/auth';
import { normalizeAccessCode, ACCESS_CODE_MIN_LENGTH } from '@/lib/utils/access-code';
import { assignPoolsFromScores, computePlayerScores, type PlayerScore } from '@/lib/services/event-player';
import {
  computeTeamPairings,
  teamFormatError,
  teamSizeShortfallMessage,
  usesPools,
  type TeamFormat,
} from '@/lib/services/team';
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
  assertRosterCurrent,
  resolvePoolAssignments,
  validatePoolPairing,
  validateTeamComposition,
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
  team_size?: number;
  team_assignment?: TeamAssignment;
  copy_players_from_event_id?: string;
}) {
  // 1. Auth check
  const { user, pg } = await authorizeLeagueAdmin(data.league_id);

  const formatError = teamFormatError({
    teamSize: data.team_size ?? 2,
    teamAssignment: data.team_assignment ?? 'random_pairing',
  });
  if (formatError) {
    throw new BadRequestError(formatError);
  }

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
    const shortfall = teamSizeShortfallMessage(currentEvent.players.length, currentEvent.team_size);
    if (shortfall) {
      throw new BadRequestError(`${shortfall} before starting bracket play`);
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
  team_size?: number;
  team_assignment?: TeamAssignment;
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

  if (patch.team_size !== undefined || patch.team_assignment !== undefined) {
    // Teams are formed when bracket play starts; after that the format is history.
    if (current.status !== 'created' && current.status !== 'pre-bracket') {
      throw new BadRequestError('Team format can only be changed before bracket play starts');
    }
    const formatError = teamFormatError({
      teamSize: patch.team_size ?? current.team_size,
      teamAssignment: patch.team_assignment ?? current.team_assignment,
    });
    if (formatError) {
      throw new BadRequestError(formatError);
    }
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
    ...(patch.team_size !== undefined ? { team_size: patch.team_size } : {}),
    ...(patch.team_assignment !== undefined ? { team_assignment: patch.team_assignment } : {}),
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
 * Preview the teams for a pre-bracket event without persisting anything.
 * Random formats return the server's draw; manual assignment returns the roster
 * with scores and no teams, for the organizer to build.
 */
export async function previewTeams(eventId: string): Promise<TeamPreview> {
  await requireEventAdmin(eventId);
  const event = await getEventWithPlayers(eventId);
  if (event.status !== 'pre-bracket') {
    throw new BadRequestError('Team preview is only available for events in pre-bracket status');
  }

  const format: TeamFormat = { teamSize: event.team_size, teamAssignment: event.team_assignment };
  const playerScores = await computePlayerScores(eventId, event);
  const entrants: Array<PlayerScore & { pool: 'A' | 'B' | null }> = usesPools(format)
    ? assignPoolsFromScores(playerScores)
    : playerScores.map((player) => ({ ...player, pool: null }));
  const teamPairings = format.teamAssignment === 'manual' ? [] : computeTeamPairings(format, entrants);

  return {
    teamSize: format.teamSize,
    teamAssignment: format.teamAssignment,
    players: entrants.map((entrant) => ({
      eventPlayerId: entrant.eventPlayerId,
      playerName: entrant.playerName,
      pfaScore: entrant.pfaScore,
      scoringMethod: entrant.scoringMethod,
      pool: entrant.pool,
    })),
    teamPairings,
  };
}

/**
 * Handle the transition from pre-bracket to bracket status, in one transaction:
 * player scores (and pools, for the random doubles draw), teams, lanes, event status,
 * bracket structure and initial lane assignments all commit together or not at all.
 *
 * @param eventId - The event ID
 * @param event - The event with details
 * @param providedPoolAssignments - Pool choice from the preview; random doubles draw only
 * @param providedTeamPairings - Teams from the preview; required for manual assignment
 * @param options.teamAssignment - 'manual' when the organizer hand-edited a random draw;
 *   recorded on the event in the same transaction that starts the bracket
 */
export async function transitionEventToBracket(
  eventId: string,
  event: EventWithDetails,
  providedPoolAssignments?: ProvidedPoolAssignment[],
  providedTeamPairings?: ProvidedTeamPairing[],
  options: { teamAssignment?: 'manual' } = {}
) {
  const { pg } = await requireEventAdmin(eventId);

  await validateEventStatusTransition(eventId, 'bracket', event, pg);

  const format: TeamFormat = {
    teamSize: event.team_size,
    teamAssignment: options.teamAssignment ?? event.team_assignment,
  };
  if (usesPools(format)) {
    if ((providedPoolAssignments === undefined) !== (providedTeamPairings === undefined)) {
      throw new BadRequestError('Pool assignments and team pairings must be provided together');
    }
  } else if (providedPoolAssignments !== undefined) {
    throw new BadRequestError('Pool assignments apply only to the random doubles draw');
  }
  if (format.teamAssignment === 'manual' && providedTeamPairings === undefined) {
    throw new BadRequestError('Build every team before starting bracket play');
  }

  // Use provided pairings if available, otherwise compute new ones
  const playerScores = await computePlayerScores(eventId, event);
  const recomputedPools = usesPools(format) ? assignPoolsFromScores(playerScores) : undefined;
  const poolAssignments = recomputedPools && (providedPoolAssignments ?? recomputedPools);
  const teamPairings = providedTeamPairings ?? computeTeamPairings(format, recomputedPools ?? playerScores);

  await startBracket(pg, eventId, poolAssignments, teamPairings, playerScores, options);
}

/**
 * Start bracket play for a pre-bracket event (the transactional part of
 * `transitionEventToBracket`). Callers authorize and validate first.
 *
 * The team format is read from the locked event row. Every format validates team
 * composition; only the random doubles draw takes pool assignments and validates
 * pool pairing. `playerScores` are the server-computed scores; when omitted they
 * are taken from complete `poolAssignments`. `options.teamAssignment` switches the
 * event to manual assignment as part of the start, so a cancelled or failed start
 * leaves the event's format unchanged.
 */
export async function startBracket(
  pg: Executor,
  eventId: string,
  poolAssignments: ProvidedPoolAssignment[] | undefined,
  teamPairings: ProvidedTeamPairing[],
  playerScores?: PlayerScore[],
  options: { teamAssignment?: 'manual' } = {}
): Promise<void> {
  const authoritativeScores = playerScores ?? (poolAssignments ?? []).map((assignment) => {
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

    const format: TeamFormat = {
      teamSize: current.team_size,
      teamAssignment: options.teamAssignment ?? current.team_assignment,
    };
    if (format.teamAssignment !== current.team_assignment) {
      await eventDb.updateEventSettings(tx, eventId, { team_assignment: format.teamAssignment });
    }
    const pools = usesPools(format);
    if (pools && poolAssignments === undefined) {
      throw new BadRequestError('Pool assignments are required for the random doubles draw');
    }
    if (!pools && poolAssignments !== undefined) {
      throw new BadRequestError('Pool assignments apply only to the random doubles draw');
    }

    const eventPlayerIds = await eventPlayerDb.getEventPlayerIds(tx, eventId);
    assertRosterCurrent(eventPlayerIds, authoritativeScores);
    const assignments = pools
      ? resolvePoolAssignments({ players: authoritativeScores, providedPoolAssignments: poolAssignments! })
      : null;
    const teams = validateTeamComposition({
      players: authoritativeScores,
      teams: teamPairings,
      teamSize: format.teamSize,
    });
    if (assignments) {
      validatePoolPairing({ teams, assignments });
    }

    // Scores are recorded for every format; pool only for the random doubles draw.
    const poolById = new Map(assignments?.map((a) => [a.eventPlayerId, a.pool]) ?? []);
    await eventPlayerDb.applyPlayerScores(
      tx,
      eventId,
      authoritativeScores.map((player) => ({
        event_player_id: player.eventPlayerId,
        pool: poolById.get(player.eventPlayerId) ?? null,
        pfa_score: player.pfaScore,
        scoring_method: player.scoringMethod,
      }))
    );

    // team_members.role is written only where it is true (pool-paired doubles), until it is dropped.
    const roleOf = (eventPlayerId: string) => {
      const pool = poolById.get(eventPlayerId);
      return pool ? (`${pool}_pool` as const) : null;
    };
    await teamDb.insertTeamsWithMembers(
      tx,
      eventId,
      teams.map((tp) => ({
        seed: tp.seed,
        pool_combo: tp.poolCombo,
        members: tp.members.map((m) => ({
          event_player_id: m.eventPlayerId,
          role: roleOf(m.eventPlayerId),
          slot: m.slot,
        })),
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
