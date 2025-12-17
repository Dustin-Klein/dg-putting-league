import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { playerId } = await request.json();
    const { eventId } = await params;

    if (!playerId) {
      return NextResponse.json(
        { error: 'Player ID is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    
    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if the player is already in the event
    const { data: existingPlayer, error: checkError } = await supabase
      .from('event_players')
      .select('*')
      .eq('event_id', eventId)
      .eq('player_id', playerId)
      .single();

    if (existingPlayer) {
      return NextResponse.json(
        { error: 'Player is already in this event' },
        { status: 400 }
      );
    }

    // Add player to the event
    const { data, error } = await supabase
      .from('event_players')
      .insert([
        { 
          event_id: eventId, 
          player_id: playerId,
          registration_status: 'registered',
          created_at: new Date().toISOString()
        }
      ])
      .select('id');

    if (error) {
      console.error('Error adding player to event:', error);
      return NextResponse.json(
        { error: 'Failed to add player to event' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in API route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
