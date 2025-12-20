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
  context: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await context.params;
    const { playerId } = await req.json();

    if (!playerId) {
      return NextResponse.json({ error: 'Player ID is required' }, { status: 400 });
    }

    await addPlayerToEvent(eventId, playerId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await context.params;
    const { playerId, hasPaid } = await req.json();

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
