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
  try {
    const { eventId, playerId } = await params;

    const schema = z.object({ paymentType: z.enum(['cash', 'electronic']).nullable() });
    const body = await req.json().catch(() => {
      throw new BadRequestError('Invalid request data');
    });
    const parsed = schema.parse(body);

    if (!playerId) {
      throw new BadRequestError('Player ID is required')
    }

    const updated = await updatePlayerPayment(eventId, playerId, parsed.paymentType);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleError(error);
  }
}