import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { EventWithDetails, PayoutPlace } from '@/lib/types/event';
import {
  ForbiddenError,
  BadRequestError,
  InternalError,
} from '@/lib/errors';
import { requireLeagueAdmin } from '@/lib/services/auth';
import { computePoolAssignments, PoolAssignment } from '@/lib/services/event-player';
import { computeTeamPairings, TeamPairing } from '@/lib/services/team';
import { createBracket } from '@/lib/services/bracket';
import { autoAssignLanes } from '@/lib/services/lane';
import { getDefaultPayoutStructure, calculatePayouts, PayoutBreakdown } from './payout-calculator';
import * as eventRepo from '@/lib/repositories/event-repository';
import * as eventPlayerRepo from '@/lib/repositories/event-player-repository';
import * as playerStatsRepo from '@/lib/repositories/player-statistics-repository';
import * as eventPlacementRepo from '@/lib/repositories/event-placement-repository';
import { logger } from '@/lib/utils/logger';

/**
 * Ensure the current user is an admin of the event's league
 */
export async function requireEventAdmin(eventId: string) {
  const supabase = await createClient();

  const leagueId = await eventRepo.getEventLeagueId(supabase, eventId);

  if (!leagueId) {
    throw new ForbiddenError('Event not found');
  }

  const { user } = await requireLeagueAdmin(leagueId);

  return { supabase, user };
}

/**
 * Get event with players (with redirect on missing eventId)
 */
export async function getEventWithPlayers(eventId: string) {
  if (!eventId) {
    console.error('No eventId provided');
    redirect('/admin/leagues');
  }

  const supabase = await createClient();
  return eventRepo.getEventWithPlayers(supabase, eventId) as Promise<EventWithDetails>;
}

/**
 * Get events by league ID (with auth check)
 */
export async function getEventsByLeagueId(leagueId: string) {
  const supabase = await createClient();

  await requireLeagueAdmin(leagueId);

  return eventRepo.getEventsByLeagueId(supabase, leagueId);
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
  const supabase = await createClient();

  // 1. Auth check
  const { user } = await requireLeagueAdmin(data.league_id);

  // 2. Normalize and check access code uniqueness
  const accessCode = data.access_code.trim();
  const isUnique = await eventRepo.isAccessCodeUnique(supabase, accessCode);
  if (!isUnique) {
    throw new BadRequestError('An event with this access code already exists');
  }

  // 3. Format date — data.event_date is already YYYY-MM-DD from the form
  const formattedDate = data.event_date;

  const { copy_players_from_event_id, entry_fee_per_player, admin_fees, admin_fee_per_player, ...eventData } = data;

  // 4. Create event via repo
  const newEvent = await eventRepo.createEvent(supabase, {
    ...eventData,
    access_code: accessCode,
    event_date: formattedDate,
    entry_fee_per_player: entry_fee_per_player ?? null,
    admin_fees: admin_fees ?? null,
    admin_fee_per_player: admin_fee_per_player ?? null,
    status: 'created',
  });

  // 5. Copy players from source event if specified
  if (copy_players_from_event_id) {
    try {
      const sourceLeagueId = await eventRepo.getEventLeagueId(supabase, copy_players_from_event_id);
      if (sourceLeagueId !== data.league_id) {
        throw new BadRequestError('Source event must belong to the same league');
      }
      const playerIds = await eventPlayerRepo.getPlayerIdsByEvent(supabase, copy_players_from_event_id);
      await eventPlayerRepo.insertEventPlayersBulk(supabase, newEvent.id, playerIds);
    } catch (err) {
      logger.error('Event creation failed during player copy', {
        userId: user.id,
        action: 'create_event',
        eventId: newEvent.id,
        leagueId: data.league_id,
        adminFees: admin_fees ?? null,
        entryFee: entry_fee_per_player ?? null,
        outcome: 'failure',
        error: err instanceof Error ? err.message : String(err),
      });
      await eventRepo.deleteEvent(supabase, newEvent.id);
      throw err;
    }
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
 * Delete an event and all related records
 */
export async function deleteEvent(eventId: string) {
  const { supabase } = await requireEventAdmin(eventId);
  await eventRepo.deleteEvent(supabase, eventId);
}

/**
 * Validate event status transition and business rules
 */
export async function validateEventStatusTransition(
  eventId: string,
  newStatus: string,
  currentEvent: EventWithDetails
) {
  const currentStatus = currentEvent.status;

  // Validate status flow
  const statusFlow: Record<string, string[]> = {
    'created': ['pre-bracket'],
    'pre-bracket': ['bracket'],
    'bracket': ['completed'],
    'completed': []
  };

  if (!statusFlow[currentStatus]?.includes(newStatus)) {
    throw new BadRequestError(`Invalid status transition from ${currentStatus} to ${newStatus}`);
  }

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
      const supabase = await createClient();

      const qualificationRound = await eventRepo.getQualificationRound(supabase, eventId);

      if (!qualificationRound) {
        throw new BadRequestError('No qualification round found for this event');
      }

      const frameCounts = await eventRepo.getQualificationFrameCounts(supabase, eventId);

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

/**
 * Update an event
 */
export async function updateEvent(
  eventId: string,
  data: Record<string, unknown>
) {
  const { supabase } = await requireEventAdmin(eventId);
  return eventRepo.updateEvent(supabase, eventId, data);
}

/**
 * Handle the transition from pre-bracket to bracket status.
 * Uses an atomic database transaction (RPC) to ensure all operations
 * succeed or fail together, preventing data inconsistency.
 *
 * Steps performed atomically:
 * 1. Update event status to 'bracket'
 * 2. Assign players to pools (A/B based on scores)
 * 3. Create teams (pairing pool A and B players)
 * 4. Create lanes
 *
 * After atomic transaction succeeds:
 * 5. Create bracket structure (uses brackets-manager library)
 * 6. Auto-assign lanes to initial matches
 *
 * @param eventId - The event ID
 * @param event - The event with details
 * @param providedPoolAssignments - Optional pre-computed pool assignments (from preview)
 * @param providedTeamPairings - Optional pre-computed team pairings (from preview)
 */
export async function transitionEventToBracket(
  eventId: string,
  event: EventWithDetails,
  providedPoolAssignments?: PoolAssignment[],
  providedTeamPairings?: TeamPairing[]
) {
  const { supabase } = await requireEventAdmin(eventId);

  await validateEventStatusTransition(eventId, 'bracket', event);

  // Use provided pairings if available, otherwise compute new ones
  const poolAssignments = providedPoolAssignments ?? await computePoolAssignments(eventId, event);
  const teamPairings = providedTeamPairings ?? computeTeamPairings(poolAssignments);

  // Convert to JSON format for RPC
  const poolAssignmentsJson = poolAssignments.map((pa: PoolAssignment) => ({
    event_player_id: pa.eventPlayerId,
    pool: pa.pool,
    pfa_score: pa.pfaScore,
    scoring_method: pa.scoringMethod,
  }));

  const teamsJson = teamPairings.map((tp: TeamPairing) => ({
    seed: tp.seed,
    pool_combo: tp.poolCombo,
    members: tp.members.map((m) => ({
      event_player_id: m.eventPlayerId,
      role: m.role,
    })),
  }));

  // Execute atomic transition RPC
  const { error } = await supabase.rpc('transition_event_to_bracket', {
    p_event_id: eventId,
    p_pool_assignments: poolAssignmentsJson,
    p_teams: teamsJson,
    p_lane_count: event.lane_count || 0,
  });

  if (error) {
    throw new InternalError(`Failed to transition event to bracket: ${error.message}`);
  }

  // After atomic transaction succeeds, create bracket structure
  // (uses brackets-manager JS library, already idempotent)
  try {
    await createBracket(eventId, true);
  } catch (error) {
    if (error instanceof BadRequestError && error.message.includes('already been created')) {
      // Idempotent - bracket exists, continue
    } else {
      // Rollback the transition
      const originalErrorMessage = error instanceof Error ? error.message : String(error);
      const { error: rollbackError } = await supabase.rpc('rollback_bracket_transition', {
        p_event_id: eventId,
      });
      if (rollbackError) {
        console.error('Rollback failed:', rollbackError);
        throw new InternalError(
          `CRITICAL: Bracket creation failed and the automatic rollback also failed. Manual intervention required. ` +
          `Original error: ${originalErrorMessage}. Rollback error: ${rollbackError.message}`
        );
      }
      throw new InternalError(
        `Failed to create bracket. Transaction rolled back. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Auto-assign lanes to initial ready matches
  if (event.lane_count && event.lane_count > 0) {
    try {
      await autoAssignLanes(eventId);
    } catch (error) {
      console.error('Auto-assign lanes error:', error);
    }
  }
}

/**
 * Finalize event placements when transitioning to completed status.
 * Calculates final placements from bracket results and stores them for fast retrieval.
 */
export async function finalizeEventPlacements(eventId: string): Promise<void> {
  const supabase = await createClient();

  const placements = await playerStatsRepo.calculateEventPlacements(supabase, eventId);

  if (placements.length > 0) {
    await eventPlacementRepo.storeEventPlacements(supabase, placements);
  }
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
  const supabase = await createClient();
  const event = await eventRepo.getEventWithPlayers(supabase, eventId);

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
  const { supabase } = await requireEventAdmin(eventId);

  const event = await eventRepo.getEventById(supabase, eventId);
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

  await eventRepo.updateEventPayouts(supabase, eventId, payoutStructure, payoutPoolOverride);
}
