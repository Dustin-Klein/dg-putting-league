import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { EventWithDetails } from '@/lib/types/event';
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
import * as eventRepo from '@/lib/repositories/event-repository';
import * as playerStatsRepo from '@/lib/repositories/player-statistics-repository';
import * as eventPlacementRepo from '@/lib/repositories/event-placement-repository';

/**
 * Ensure the current user is an admin of the event's league
 */
export async function requireEventAdmin(eventId: string) {
  const supabase = await createClient();

  const leagueId = await eventRepo.getEventLeagueId(supabase, eventId);

  if (!leagueId) {
    throw new ForbiddenError('Event not found');
  }

  await requireLeagueAdmin(leagueId);

  return { supabase };
}

/**
 * Get event with players (with redirect on missing eventId)
 */
export async function getEventWithPlayers(eventId: string) {
  if (!eventId) {
    console.error('No eventId provided');
    redirect('/leagues');
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
}) {
  const supabase = await createClient();

  // 1. Auth check
  await requireLeagueAdmin(data.league_id);

  // 2. Normalize and check access code uniqueness
  const accessCode = data.access_code.trim();
  const isUnique = await eventRepo.isAccessCodeUnique(supabase, accessCode);
  if (!isUnique) {
    throw new BadRequestError('An event with this access code already exists');
  }

  // 3. Format date
  const eventDate = new Date(data.event_date);
  const formattedDate = eventDate.toISOString().split('T')[0];

  // 4. Create event via repo
  return eventRepo.createEvent(supabase, {
    ...data,
    access_code: accessCode,
    event_date: formattedDate,
    status: 'created',
  });
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
    if (currentEvent.qualification_round_enabled) {
      const supabase = await createClient();

      const qualificationRound = await eventRepo.getQualificationRound(supabase, eventId);

      if (!qualificationRound) {
        throw new BadRequestError('No qualification round found for this event');
      }

      const frameCounts = await eventRepo.getQualificationFrameCounts(supabase, eventId);

      // Check if all players have completed the required number of frames
      const incompletePlayers = currentEvent.players.filter(
        (player) => (frameCounts[player.id] || 0) < qualificationRound.frame_count
      );

      if (incompletePlayers.length > 0) {
        throw new BadRequestError(
          `All players must complete ${qualificationRound.frame_count} qualifying frames before starting bracket play`
        );
      }
    } else {
      // Check if all players have paid
      const unpaidPlayers = currentEvent.players.filter(
        (player) => !player.has_paid
      );
      if (unpaidPlayers.length > 0) {
        throw new BadRequestError(
          'All players must be marked as paid before starting bracket play'
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
