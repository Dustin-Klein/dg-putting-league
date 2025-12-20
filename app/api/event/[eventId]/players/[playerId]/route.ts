import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addPlayerToEvent, removePlayerFromEvent, updatePlayerPayment } from '@/lib/event-player';
import { BadRequestError, NotFoundError, handleError } from '@/lib/errors';
import { logger } from '@/lib/logger';

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
    logger.info('player_added_to_event', { eventId, playerId, eventPlayerId: newEventPlayer.id });

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
    const result = await removePlayerFromEvent(eventId, playerId);
    logger.info('player_removed_from_event', { eventId, eventPlayerId: playerId });

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
  } catch (e) {
    throw new BadRequestError('Invalid request data');
  }

  try {
    if (playerId === undefined) {
      throw new BadRequestError('Player ID and payment status are required')
    }

    const updated = await updatePlayerPayment(eventId, playerId, parsed.hasPaid);
    logger.info('player_payment_updated', { eventId, playerId, hasPaid: parsed.hasPaid });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleError(error);
  }
}