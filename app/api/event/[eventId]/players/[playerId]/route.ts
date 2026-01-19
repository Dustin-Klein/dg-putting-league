import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addPlayerToEvent, removePlayerFromEvent, updatePlayerPayment } from '@/lib/services/event-player';
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

    // removePlayerFromEvent returns success regardless; add an existence check by attempting delete and verifying affected row
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

  const schema = z.object({ hasPaid: z.boolean() });
  let parsed: { hasPaid: boolean };
  try {
    const body = await req.json();
    parsed = schema.parse(body);
  } catch {
    throw new BadRequestError('Invalid request data');
  }

  try {
    if (playerId === undefined) {
      throw new BadRequestError('Player ID and payment status are required')
    }

    const updated = await updatePlayerPayment(eventId, playerId, parsed.hasPaid);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleError(error);
  }
}