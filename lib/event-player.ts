import 'server-only';
import {
  NotFoundError,
  BadRequestError,
  InternalError,
} from '@/lib/errors';
import { requireEventAdmin, getEventWithPlayers } from './event';


export async function addPlayerToEvent(eventId: string, playerId: string) {
  const { supabase } = await requireEventAdmin(eventId);

  // Check event status - players can only be added when event is in pre-bracket status
  const event = await getEventWithPlayers(eventId);
  if (event.status !== 'pre-bracket') {
    throw new BadRequestError('Players can only be added to events in pre-bracket status');
  }

  // Check if the player is already in the event
  const { data: existingPlayer, error: checkError } = await supabase
    .from('event_players')
    .select('*')
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (checkError) throw new InternalError(checkError.message);

  if (existingPlayer) throw new BadRequestError('Player is already in this event');

  // Insert player
  const { data, error } = await supabase
    .from('event_players')
    .insert([
      {
        event_id: eventId,
        player_id: playerId,
        has_paid: false,
        created_at: new Date().toISOString(),
      },
    ])
    .select('id');

  if (error || !data || !data[0]?.id) throw new InternalError('Failed to add player to event');

  const insertedId = data[0].id as string;

  // Fetch the inserted row with nested player info for client state updates
  const { data: inserted, error: fetchError } = await supabase
    .from('event_players')
    .select(`
      id,
      event_id,
      player_id,
      has_paid,
      created_at,
      player:players(
        id,
        full_name,
        nickname,
        email,
        created_at,
        default_pool,
        player_number
      )
    `)
    .eq('id', insertedId)
    .single();

  if (fetchError || !inserted) throw new InternalError('Failed to fetch added player');

  return inserted;
}


export async function removePlayerFromEvent(
  eventId: string,
  eventPlayerId: string
) {
  if (!eventPlayerId) {
    throw new BadRequestError('Event Player ID is required');
  }

  const { supabase } = await requireEventAdmin(eventId);

  // Check event status - players can only be removed when event is in pre-bracket status
  const event = await getEventWithPlayers(eventId);
  if (event.status !== 'pre-bracket') {
    throw new BadRequestError('Players can only be removed from events in pre-bracket status');
  }

  const { error } = await supabase
    .from('event_players')
    .delete()
    .eq('id', eventPlayerId)
    .eq('event_id', eventId);

  if (error) {
    throw new InternalError('Failed to remove player from event');
  }

  return { success: true };
}

export async function updatePlayerPayment(eventId: string, playerId: string, hasPaid: boolean) {
  const { supabase } = await requireEventAdmin(eventId);

  const { data, error } = await supabase
    .from('event_players')
    .update({ has_paid: hasPaid })
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .select('id, has_paid');

  if (error) throw new InternalError('Failed to update payment status');

  if (!data || data.length === 0) throw new NotFoundError('Player not found in this event');

  return data[0];
}
