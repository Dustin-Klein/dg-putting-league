import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const updateEventSchema = z.object({
  status: z.enum(['registration', 'qualification', 'bracket', 'completed']).optional(),
  // Add other fields that can be updated here
});

export async function GET(
  request: Request,
  { params }: { params: { eventId: string } }
) {
  try {
    const supabase = await createClient();
    const eventId = params.eventId;

    // Get the event with player details
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        *,
        players:event_players(
          id,
          created_at,
          player:players(
            id,
            name,
            email,
            pdga_number,
            phone_number,
            created_at,
            display_identifier
          )
        )
      `)
      .eq('id', eventId)
      .single();

    if (eventError) {
      console.error('Error fetching event:', eventError);
      return NextResponse.json(
        { error: 'Failed to fetch event' },
        { status: 500 }
      );
    }

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    // Get participant count
    const { count, error: countError } = await supabase
      .from('event_players')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId);

    if (countError) {
      console.error('Error counting participants:', countError);
    }

    return NextResponse.json({
      ...event,
      participant_count: count || 0,
    });
  } catch (error) {
    console.error('Error in event API route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { eventId: string } }
) {
  try {
    const supabase = await createClient();
    const eventId = params.eventId;
    
    // Check if user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = updateEventSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request data', details: validation.error.issues },
        { status: 400 }
      );
    }

    // Check if user is an admin of this event's league
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('league_id')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    const { data: leagueAdmin, error: adminError } = await supabase
      .from('league_admins')
      .select('*')
      .eq('league_id', event.league_id)
      .eq('user_id', user.id)
      .single();

    if (adminError || !leagueAdmin) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Update the event
    const { data: updatedEvent, error: updateError } = await supabase
      .from('events')
      .update(validation.data)
      .eq('id', eventId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating event:', updateError);
      return NextResponse.json(
        { error: 'Failed to update event' },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedEvent);
  } catch (error) {
    console.error('Error in event update API route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
