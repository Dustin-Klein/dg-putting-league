import { createClient } from '@/lib/supabase/server';
import { InternalError, NotFoundError } from '@/lib/errors';

export interface EventData {
  id: string;
  league_id: string;
  event_date: string;
  status: 'created' | 'pre-bracket' | 'bracket' | 'completed';
  lane_count: number | null;
  qualification_round_enabled: boolean;
  access_code: string | null;
  created_at: string;
}

export interface EventWithPlayersData extends EventData {
  players: EventPlayerInEvent[];
  teams: TeamInEvent[];
}

export interface EventPlayerInEvent {
  id: string;
  event_id: string;
  player_id: string;
  created_at: string;
  has_paid: boolean;
  pool: 'A' | 'B' | null;
  pfa_score: number | null;
  scoring_method: 'qualification' | 'pfa' | 'default' | null;
  player: PlayerInEvent;
}

export interface PlayerInEvent {
  id: string;
  full_name: string;
  nickname: string | null;
  email: string | null;
  created_at: string;
  default_pool: 'A' | 'B' | null;
  player_number: number | null;
}

export interface TeamInEvent {
  id: string;
  seed: number;
  pool_combo: string;
  created_at: string;
  team_members: TeamMemberInEvent[];
}

export interface TeamMemberInEvent {
  team_id: string;
  event_player_id: string;
  role: 'A_pool' | 'B_pool' | 'alternate';
  joined_at: string;
  event_player: EventPlayerInEvent;
}

/**
 * Get event with all players and teams
 */
export async function getEventWithPlayers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<EventWithPlayersData> {
  const { data: event, error } = await supabase
    .from('events')
    .select(`
      *,
      players:event_players(
        id,
        event_id,
        player_id,
        created_at,
        has_paid,
        pool,
        pfa_score,
        scoring_method,
        player:players(
          id,
          full_name,
          nickname,
          email,
          created_at,
          default_pool,
          player_number
        )
      ),
      teams:teams(
        id,
        seed,
        pool_combo,
        created_at,
        team_members(
          team_id,
          event_player_id,
          role,
          joined_at,
          event_player:event_players(
            id,
            event_id,
            player_id,
            created_at,
            has_paid,
            pool,
            pfa_score,
            scoring_method,
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
        )
      )
    `)
    .eq('id', eventId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch event: ${error.message}`);
  }

  if (!event) {
    throw new NotFoundError('Event not found');
  }

  return event as unknown as EventWithPlayersData;
}

/**
 * Get event by ID (basic fields only)
 */
export async function getEventById(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<EventData | null> {
  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch event: ${error.message}`);
  }

  return event as EventData | null;
}

/**
 * Get event's league_id
 */
export async function getEventLeagueId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<string | null> {
  const { data: event, error } = await supabase
    .from('events')
    .select('league_id')
    .eq('id', eventId)
    .single();

  if (error) {
    return null;
  }

  return event?.league_id ?? null;
}

/**
 * Get events by league ID with participant counts
 */
export async function getEventsByLeagueId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string
): Promise<(EventData & { participant_count: number })[]> {
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('*')
    .eq('league_id', leagueId)
    .order('event_date', { ascending: false });

  if (eventsError) {
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
      throw new InternalError('Failed to fetch participant counts');
    }

    for (const row of epRows ?? []) {
      countsByEvent[row.event_id] = (countsByEvent[row.event_id] ?? 0) + 1;
    }
  }

  return (events ?? []).map((event) => ({
    ...event,
    participant_count: countsByEvent[event.id] ?? 0,
  })) as (EventData & { participant_count: number })[];
}

/**
 * Update event data
 */
export async function updateEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  data: Record<string, unknown>
): Promise<EventData> {
  const { data: updatedEvent, error } = await supabase
    .from('events')
    .update(data)
    .eq('id', eventId)
    .select()
    .single();

  if (error || !updatedEvent) {
    throw new InternalError('Failed to update event');
  }

  return updatedEvent as EventData;
}

/**
 * Update event status
 */
export async function updateEventStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  status: EventData['status']
): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({ status })
    .eq('id', eventId);

  if (error) {
    throw new InternalError(`Failed to update event status: ${error.message}`);
  }
}

/**
 * Delete an event
 */
export async function deleteEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<void> {
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId);

  if (error) {
    throw new InternalError('Failed to delete event');
  }
}

/**
 * Get qualification round for an event
 */
export async function getQualificationRound(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<{ frame_count: number } | null> {
  const { data: qualificationRound, error } = await supabase
    .from('qualification_rounds')
    .select('frame_count')
    .eq('event_id', eventId)
    .single();

  if (error) {
    return null;
  }

  return qualificationRound;
}

/**
 * Get qualification frame counts per player
 */
export async function getQualificationFrameCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<Record<string, number>> {
  const { data: playerFrames, error } = await supabase
    .from('qualification_frames')
    .select('event_player_id')
    .eq('event_id', eventId);

  if (error) {
    throw new InternalError(`Failed to fetch qualification frames: ${error.message}`);
  }

  const frameCounts: Record<string, number> = {};
  playerFrames?.forEach(frame => {
    frameCounts[frame.event_player_id] = (frameCounts[frame.event_player_id] || 0) + 1;
  });

  return frameCounts;
}
