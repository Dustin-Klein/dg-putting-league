import { createClient } from '@/lib/supabase/server';
import type { PrivilegedClient } from '@/lib/supabase/types';
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
  created_at: string;
}

/**
 * Every events column except access_code. Clients (anon/authenticated) have no
 * SELECT privilege on access_code, so `select('*')` on events fails for them.
 */
export const EVENT_COLUMNS = 'id, league_id, event_date, location, lane_count, putt_distance_ft, bonus_point_enabled, qualification_round_enabled, bracket_frame_count, qualification_frame_count, double_grand_final, entry_fee_per_player, admin_fees, admin_fee_per_player, payout_pool_override, payout_structure, status, created_at';

export interface EventWithPlayersData extends EventData {
  players: EventPlayer[];
  teams: Team[];
}

/**
 * Get event with all players and teams
 */
export async function getEventWithPlayers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  opts: { includePaymentType?: boolean } = {}
): Promise<EventWithPlayersData> {
  // Clients can't read event_players.payment_type; only privileged (admin) reads include it.
  const paymentType = opts.includePaymentType ? 'payment_type,' : '';
  const { data: event, error } = await supabase
    .from('events')
    .select(`
      ${EVENT_COLUMNS},
      players:event_players(
        id,
        event_id,
        player_id,
        created_at,
        ${paymentType}
        pool,
        pfa_score,
        scoring_method,
        player:players(
          id,
          full_name,
          nickname,
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
            ${paymentType}
            pool,
            pfa_score,
            scoring_method,
            player:players(
              id,
              full_name,
              nickname,
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
    .select(EVENT_COLUMNS)
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
    .select(EVENT_COLUMNS)
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
  supabase: PrivilegedClient,
  eventId: string,
  data: Record<string, unknown>
): Promise<EventData> {
  const { data: updatedEvent, error } = await supabase
    .from('events')
    .update(data)
    .eq('id', eventId)
    .select(EVENT_COLUMNS)
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
  supabase: PrivilegedClient,
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
  supabase: PrivilegedClient,
  eventId: string
): Promise<void> {
  const { data, error } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId)
    .select('id');

  if (error) {
    throw new InternalError('Failed to delete event');
  }

  // RLS filters rows instead of erroring, so a blocked delete affects zero rows
  if (!data || data.length === 0) {
    throw new NotFoundError('Event not found or you do not have permission to delete it');
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

export interface AccessCodeEvent {
  id: string;
  event_date: string;
  location: string | null;
  lane_count: number;
  bonus_point_enabled: boolean;
  bracket_frame_count: number;
  qualification_round_enabled: boolean;
  qualification_frame_count: number;
  status: EventStatus;
}

/**
 * Get the event an access code belongs to.
 * `accessCode` must already be normalized; it is matched exactly (never with LIKE).
 */
export async function getEventByAccessCode(
  supabase: PrivilegedClient,
  accessCode: string
): Promise<AccessCodeEvent | null> {
  const { data: event, error } = await supabase
    .from('events')
    .select('id, event_date, location, lane_count, bonus_point_enabled, bracket_frame_count, qualification_round_enabled, qualification_frame_count, status')
    .eq('access_code', accessCode)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch event by access code: ${error.message}`);
  }

  return event as AccessCodeEvent | null;
}

/**
 * Get an event's access code (admin display only)
 */
export async function getEventAccessCode(
  supabase: PrivilegedClient,
  eventId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('events')
    .select('access_code')
    .eq('id', eventId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch event access code: ${error.message}`);
  }

  return (data?.access_code as string | undefined) ?? null;
}

/**
 * Check if an access code is already in use across all leagues.
 * `accessCode` must already be normalized.
 */
export async function isAccessCodeUnique(
  supabase: PrivilegedClient,
  accessCode: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('access_code', accessCode)
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
  supabase: PrivilegedClient,
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
    .select(EVENT_COLUMNS)
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
  supabase: PrivilegedClient,
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
