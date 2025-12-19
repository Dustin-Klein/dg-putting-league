import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ eventId: string; playerId: string }> }
) {
  try {
    const resolvedParams = await params;
    const { eventId, playerId: eventPlayerId } = resolvedParams;

    if (!eventPlayerId) {
      return NextResponse.json(
        { error: 'Event Player ID is required' },
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

    // Delete the player from the event
    const { error } = await supabase
      .from('event_players')
      .delete()
      .eq('id', eventPlayerId)
      .eq('event_id', eventId);

    if (error) {
      console.error('Error removing player from event:', error);
      return NextResponse.json(
        { error: 'Failed to remove player from event' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE API route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}