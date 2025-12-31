import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { EventWithDetails } from '@/lib/types/event';
import {
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from '@/lib/errors';
import { requireAuthenticatedUser } from '@/lib/services/auth';
import { splitPlayersIntoPools } from '@/lib/services/event-player';
import { generateTeams } from '@/lib/services/team';
import { createBracket } from '@/lib/services/bracket';
import { createEventLanes, autoAssignLanes } from '@/lib/services/lane';
import * as eventRepo from '@/lib/repositories/event-repository';

/**
 * Ensure the current user is an admin of the event's league
 */
export async function requireEventAdmin(eventId: string) {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser();

  const leagueId = await eventRepo.getEventLeagueId(supabase, eventId);

  if (!leagueId) {
    throw new ForbiddenError('Event not found');
  }

  const { data: leagueAdmin } = await supabase
    .from('league_admins')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!leagueAdmin) {
    throw new ForbiddenError();
  }

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

  // Auth check
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new UnauthorizedError();
  }

  // Authorization check
  const { data: leagueAdmin, error: adminError } = await supabase
    .from('league_admins')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (adminError || !leagueAdmin) {
    throw new ForbiddenError('User is not an admin of this league');
  }

  return eventRepo.getEventsByLeagueId(supabase, leagueId);
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
 * Orchestrates pool assignment, team generation, bracket creation, and lane setup.
 *
 * Note: Ideally these sequential operations would be wrapped in a database
 * function (RPC) to ensure atomicity. The current implementation uses
 * idempotent operations as a fallback - each step checks if already done.
 */
export async function transitionEventToBracket(
  eventId: string,
  event: EventWithDetails
) {
  const { supabase } = await requireEventAdmin(eventId);

  // 1. Update status to 'bracket' first so subsequent RPC checks pass
  await eventRepo.updateEventStatus(supabase, eventId, 'bracket');

  // 2. Split players into pools
  try {
    await splitPlayersIntoPools(eventId);
  } catch (error) {
    if (!(error instanceof BadRequestError && error.message.includes('already been assigned'))) {
      throw error;
    }
  }

  // 3. Generate teams
  try {
    await generateTeams(eventId);
  } catch (error) {
    if (!(error instanceof BadRequestError && error.message.includes('already been generated'))) {
      throw error;
    }
  }

  // 4. Generate bracket
  try {
    await createBracket(eventId, true);
  } catch (error) {
    if (!(error instanceof BadRequestError && error.message.includes('already been created'))) {
      throw error;
    }
  }

  // 5. Create lanes based on lane_count
  if (event.lane_count && event.lane_count > 0) {
    try {
      await createEventLanes(eventId, event.lane_count);
    } catch (error) {
      // Lane creation is idempotent - ignore if already created
      console.error('Lane creation error (may be expected):', error);
    }

    // 6. Auto-assign lanes to initial ready matches
    try {
      await autoAssignLanes(eventId);
    } catch (error) {
      console.error('Auto-assign lanes error:', error);
    }
  }
}
