import { createClient } from '@/lib/supabase/server';
import { InternalError, NotFoundError } from '@/lib/errors';
import type { EventStatus, PayoutPlace } from '@/lib/types/event';
import type { EventPlayer } from '@/lib/types/player';
import type { Team } from '@/lib/types/team';

export interface EventData {
  id: string;
  league_id: string;
  event_date: string;
  status: EventStatus;
  lane_count: number | null;
  location: string | null;
  putt_distance_ft: number | null;
  qualification_round_enabled: boolean;
  bracket_frame_count: number;
  qualification_frame_count: number;
  double_grand_final: boolean;
  entry_fee_per_player: number | null;
  admin_fees: number | null;
  admin_fee_per_player: number | null;
  payout_pool_override: number | null;
  payout_structure: PayoutPlace[] | null;
  access_code: string | null;
  created_at: string;
}

export interface EventWithPlayersData extends EventData {
  players: EventPlayer[];
  teams: Team[];
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
        payment_type,
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
            payment_type,
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
  const countsByEvent: Record<string, number> = {};
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

/**
 * Get event by access code for qualification scoring
 * Returns only events that are in pre-bracket status with qualification enabled
 */
export async function getEventByAccessCodeForQualification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accessCode: string
): Promise<{
  id: string;
  event_date: string;
  location: string | null;
  lane_count: number;
  bonus_point_enabled: boolean;
  qualification_round_enabled: boolean;
  qualification_frame_count: number;
  status: string;
} | null> {
  const { data: event, error } = await supabase
    .from('events')
    .select('id, event_date, location, lane_count, bonus_point_enabled, qualification_round_enabled, qualification_frame_count, status')
    .ilike('access_code', accessCode)
    .eq('status', 'pre-bracket')
    .eq('qualification_round_enabled', true)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch event by access code: ${error.message}`);
  }

  return event as {
    id: string;
    event_date: string;
    location: string | null;
    lane_count: number;
    bonus_point_enabled: boolean;
    qualification_round_enabled: boolean;
    qualification_frame_count: number;
    status: string;
  } | null;
}

/**
 * Get event by access code for bracket scoring
 * Returns only events that are in bracket status
 */
export async function getEventByAccessCodeForBracket(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accessCode: string
): Promise<{
  id: string;
  event_date: string;
  location: string | null;
  lane_count: number;
  bonus_point_enabled: boolean;
  bracket_frame_count: number;
  status: string;
} | null> {
  const { data: event, error } = await supabase
    .from('events')
    .select('id, event_date, location, lane_count, bonus_point_enabled, bracket_frame_count, status')
    .ilike('access_code', accessCode)
    .eq('status', 'bracket')
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch event by access code: ${error.message}`);
  }

  return event as {
    id: string;
    event_date: string;
    location: string | null;
    lane_count: number;
    bonus_point_enabled: boolean;
    bracket_frame_count: number;
    status: string;
  } | null;
}

/**
 * Get event scoring configuration for validation
 */
export async function getEventScoringConfig(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<{ status: EventStatus; bonus_point_enabled: boolean } | null> {
  const { data: event, error } = await supabase
    .from('events')
    .select('status, bonus_point_enabled')
    .eq('id', eventId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch event scoring config: ${error.message}`);
  }

  return event as { status: EventStatus; bonus_point_enabled: boolean } | null;
}

/**
 * Get event basic info by access code (case insensitive)
 */
export async function getEventStatusByAccessCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accessCode: string
): Promise<{
  id: string;
  status: EventStatus;
  qualification_round_enabled: boolean;
} | null> {
  const { data: event, error } = await supabase
    .from('events')
    .select('id, status, qualification_round_enabled')
    .ilike('access_code', accessCode)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch event by access code: ${error.message}`);
  }

  return event as {
    id: string;
    status: EventStatus;
    qualification_round_enabled: boolean;
  } | null;
}

/**
 * Check if an access code is already in use (case insensitive)
 */
export async function isAccessCodeUnique(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accessCode: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('events')
    .select('id')
    .ilike('access_code', accessCode)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Error checking access code uniqueness: ${error.message}`);
  }

  return !data;
}

/**
 * Create a new event
 */
export async function createEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  data: {
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
    status: EventStatus;
  }
): Promise<EventData> {
  const { data: event, error } = await supabase
    .from('events')
    .insert(data)
    .select()
    .single();

  if (error) {
    throw new InternalError(`Failed to create event: ${error.message}`);
  }

  return event as EventData;
}

/**
 * Get event bracket frame count only
 */
export async function getEventBracketFrameCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<number | null> {
  const { data: event, error } = await supabase
    .from('events')
    .select('bracket_frame_count')
    .eq('id', eventId)
    .single();

  if (error) {
    throw new InternalError(`Failed to fetch event bracket frame count: ${error.message}`);
  }

  return event?.bracket_frame_count ?? null;
}

/**
 * Update event payout structure
 */
export async function updateEventPayouts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  payoutStructure: PayoutPlace[] | null,
  payoutPoolOverride?: number | null
): Promise<void> {
  const updateData: Record<string, unknown> = { payout_structure: payoutStructure };
  if (payoutPoolOverride !== undefined) {
    updateData.payout_pool_override = payoutPoolOverride;
  }
  const { error } = await supabase
    .from('events')
    .update(updateData)
    .eq('id', eventId);

  if (error) {
    throw new InternalError(`Failed to update event payouts: ${error.message}`);
  }
}
