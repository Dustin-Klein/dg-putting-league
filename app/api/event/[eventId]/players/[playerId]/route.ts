import { NextResponse } from 'next/server';
import { addPlayerToEvent, removePlayerFromEvent, updatePlayerPayment } from '@/lib/event-player';
import { BadRequestError, handleError } from '@/lib/errors';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string; playerId: string }> }
) {
  try {
    const resolvedParams = await params;
    const { eventId, playerId } = resolvedParams;

    if (!playerId) {
      throw new BadRequestError('Player ID is required')
    }

    const newEventPlayer = await addPlayerToEvent(eventId, playerId);

    return NextResponse.json({ success: true, data: newEventPlayer });
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

    await removePlayerFromEvent(eventId, playerId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
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
      throw new BadRequestError('Player ID and payment status are required')
    }

    const updated = await updatePlayerPayment(eventId, playerId, hasPaid);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleError(error);
  }
}