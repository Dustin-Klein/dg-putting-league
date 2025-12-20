import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  UnauthorizedError,
  NotFoundError,
  BadRequestError,
  InternalError,
} from '@/lib/errors';
import { requireEventAdmin } from './event';


export async function addPlayerToEvent(eventId: string, playerId: string) {
  const { supabase } = await requireEventAdmin(eventId);

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
    .insert([{
      event_id: eventId,
      player_id: playerId,
      has_paid: false,
      created_at: new Date().toISOString(),
    }])
    .select('id');

  if (error) throw new InternalError('Failed to add player to event');

  return data[0];
}


export async function removePlayerFromEvent(
  eventId: string,
  eventPlayerId: string
) {
  if (!eventPlayerId) {
    throw new BadRequestError('Event Player ID is required');
  }

  const supabase = await createClient();

  // Verify user is authenticated
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new UnauthorizedError();
  }

  const { error } = await supabase
    .from('event_players')
    .delete()
    .eq('id', eventPlayerId)
    .eq('event_id', eventId);

  if (error) {
    console.error('Error removing player from event:', error);
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
