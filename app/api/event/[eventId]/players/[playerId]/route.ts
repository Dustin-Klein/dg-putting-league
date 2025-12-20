import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { addPlayerToEvent, updatePlayerPayment } from '@/lib/event-player';
import { BadRequestError, UnauthorizedError, NotFoundError, InternalError } from '@/lib/errors';

function handleError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (error instanceof BadRequestError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  console.error(error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string; playerId: string }> }
) {
  try {
    const resolvedParams = await params;
    const { eventId, playerId } = resolvedParams;

    if (!playerId) {
      return NextResponse.json({ error: 'Player ID is required' }, { status: 400 });
    }

    await addPlayerToEvent(eventId, playerId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}


export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ eventId: string; playerId: string }> }
) {
  try {
    const resolvedParams = await params;
    const { eventId, playerId } = resolvedParams;

    if (!playerId) {
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
      .eq('id', playerId)
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventId: string; playerId: string }> }
) {
  const { eventId, playerId } = await params;
  const body = await req.json();
  
  const { hasPaid } = body;

  try {
    if (playerId === undefined || hasPaid === undefined) {
      return NextResponse.json(
        { error: 'Player ID and payment status are required' },
        { status: 400 }
      );
    }

    const updated = await updatePlayerPayment(eventId, playerId, hasPaid);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleError(error);
  }
}