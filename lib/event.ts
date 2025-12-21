import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { EventWithDetails } from '@/app/event/[eventId]/types';
import {
  UnauthorizedError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  BadRequestError
} from '@/lib/errors';
import { requireAuthenticatedUser } from './league-auth';

export async function getEventWithPlayers(eventId: string) {
  if (!eventId) {
    console.error('No eventId provided');
    redirect('/leagues');
  }

  const supabase = await createClient();

  const { data: event, error } = await supabase
    .from('events')
    .select(`
      *,
      players:event_players(
        id,
        created_at,
        has_paid,
        player:players(
          id,
          full_name,
          nickname,
          email,
          created_at,
          default_pool,
          player_number
        )
      )
    `)
    .eq('id', eventId)
    .maybeSingle();

  if (error || !event) {
    console.error('Error fetching event:', error);
    redirect('/leagues');
  }

  return event as unknown as EventWithDetails;
}

export async function getEventsByLeagueId(leagueId: string) {
  const supabase = await createClient();

  // Auth check
  const { data: { user }, error: userError } =
    await supabase.auth.getUser();

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
    throw new ForbiddenError(
      'User is not an admin of this league'
    );
  }

  // Fetch events
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('*')
    .eq('league_id', leagueId)
    .order('event_date', { ascending: false });

  if (eventsError) {
    console.error(eventsError);
    throw new InternalError('Failed to fetch events');
  }

  // Participant counts - optimized to avoid N+1 queries
  const eventIds = (events ?? []).map((e) => e.id);
  let countsByEvent: Record<string, number> = {};
  if (eventIds.length > 0) {
    const { data: epRows, error: epError } = await supabase
      .from('event_players')
      .select('event_id')
      .in('event_id', eventIds);

    if (epError) {
      console.error(epError);
      throw new InternalError('Failed to fetch participant counts');
    }

    for (const row of epRows ?? []) {
      // @ts-ignore - event_id exists on the selected rows
      countsByEvent[row.event_id] = (countsByEvent[row.event_id] ?? 0) + 1;
    }
  }
  const eventsWithParticipantCount = (events ?? []).map((event) => ({
    ...event,
    participant_count: countsByEvent[event.id] ?? 0,
  }));

  return eventsWithParticipantCount;
}

/**
 * Ensure the current user is an admin of the event’s league
 */
export async function requireEventAdmin(eventId: string) {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser();

  const { data: event } = await supabase
    .from('events')
    .select('league_id')
    .eq('id', eventId)
    .single();

  if (!event) {
    throw new NotFoundError('Event not found');
  }

  const { data: leagueAdmin } = await supabase
    .from('league_admins')
    .select('id')
    .eq('league_id', event.league_id)
    .eq('user_id', user.id)
    .single();

  if (!leagueAdmin) {
    throw new ForbiddenError();
  }

  return { supabase };
}


/**
 * Delete an event and all related records
 */
export async function deleteEvent(eventId: string) {
  const { supabase } = await requireEventAdmin(eventId);

  // Rely on ON DELETE CASCADE from events to related tables
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId);

  if (error) {
    throw new InternalError('Failed to delete event');
  }
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
      // Check if all players have completed qualifying rounds
      const supabase = await createClient();
      
      // Get the qualification round for this event
      const { data: qualificationRound } = await supabase
        .from('qualification_rounds')
        .select('frame_count')
        .eq('event_id', eventId)
        .single();
        
      if (!qualificationRound) {
        throw new BadRequestError(
          'No qualification round found for this event'
        );
      }
      
      // Get frame counts for each player
      const { data: playerFrames } = await supabase
        .from('qualification_frames')
        .select('event_player_id')
        .eq('event_id', eventId);
        
      // Count frames per player
      const frameCounts: Record<string, number> = {};
      playerFrames?.forEach(frame => {
        frameCounts[frame.event_player_id] = (frameCounts[frame.event_player_id] || 0) + 1;
      });
      
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

  const { data: updatedEvent, error } = await supabase
    .from('events')
    .update(data)
    .eq('id', eventId)
    .select()
    .single();

  if (error || !updatedEvent) {
    throw new InternalError('Failed to update event');
  }

  return updatedEvent;
}