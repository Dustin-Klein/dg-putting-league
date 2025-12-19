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
          has_paid: false,
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { playerId, hasPaid } = await request.json();
    const { eventId } = await params;

    if (playerId === undefined || hasPaid === undefined) {
      return NextResponse.json(
        { error: 'Player ID and payment status are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    
    // Verify user is authenticated and is an admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Update payment status
    const { data, error } = await supabase
      .from('event_players')
      .update({ has_paid: hasPaid })
      .eq('event_id', eventId)
      .eq('player_id', playerId)
      .select('id, has_paid');

    if (error) {
      console.error('Error updating payment status:', error);
      return NextResponse.json(
        { error: 'Failed to update payment status' },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Player not found in this event' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      data: { id: data[0].id, has_paid: data[0].has_paid } 
    });
  } catch (error) {
    console.error('Error in API route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
