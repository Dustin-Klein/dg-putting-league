import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface EventPlacement {
  eventId: string;
  teamId: string;
  placement: number;
}

export async function storeEventPlacements(
  supabase: SupabaseClient,
  placements: EventPlacement[]
): Promise<void> {
  if (placements.length === 0) return;

  const rows = placements.map((p) => ({
    event_id: p.eventId,
    team_id: p.teamId,
    placement: p.placement,
  }));

  const { error } = await supabase
    .from('event_placements')
    .upsert(rows, { onConflict: 'event_id,team_id' });

  if (error) {
    throw new InternalError(`Failed to store event placements: ${error.message}`);
  }
}

export async function getStoredPlacementsForEvents(
  supabase: SupabaseClient,
  eventIds: string[]
): Promise<EventPlacement[]> {
  if (eventIds.length === 0) return [];

  const { data, error } = await supabase
    .from('event_placements')
    .select('event_id, team_id, placement')
    .in('event_id', eventIds);

  if (error) {
    throw new InternalError(`Failed to fetch event placements: ${error.message}`);
  }

  if (!data) return [];

  return data.map((row) => ({
    eventId: row.event_id,
    teamId: row.team_id,
    placement: row.placement,
  }));
}

export async function getEventsWithStoredPlacements(
  supabase: SupabaseClient,
  eventIds: string[]
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('event_placements')
    .select('event_id')
    .in('event_id', eventIds);

  if (error) {
    throw new InternalError(`Failed to check stored placements: ${error.message}`);
  }

  return new Set(data?.map((row) => row.event_id) ?? []);
}
