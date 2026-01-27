import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getEventWithPlayers,
  deleteEvent,
  updateEvent,
  validateEventStatusTransition,
  finalizeEventPlacements,
} from '@/lib/services/event';
import {
  handleError,
  BadRequestError,
} from '@/lib/errors';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';

const updateEventSchema = z.object({
  status: z.enum([
    'created',
    'pre-bracket',
    'completed',
  ]).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const event = await getEventWithPlayers(resolvedParams.eventId);
    return NextResponse.json(event);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { eventId: string } | Promise<{ eventId: string }> }
) {
  const rateLimitResponse = withStrictRateLimit(request, 'event:delete');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const resolvedParams = await Promise.resolve(params);
    await deleteEvent(resolvedParams.eventId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}


export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const body = await req.json();
    const parsed = updateEventSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data');
    }

    const resolvedParams = await Promise.resolve(params);

    // Get current event with players for validation
    const currentEvent = await getEventWithPlayers(resolvedParams.eventId);

    if (parsed.data.status) {
      await validateEventStatusTransition(
        resolvedParams.eventId,
        parsed.data.status,
        currentEvent
      );

      if (currentEvent.status === 'bracket' && parsed.data.status === 'completed') {
        await finalizeEventPlacements(resolvedParams.eventId);
      }
    }

    // Update event status (happens for all other valid status changes)
    const updatedEvent = await updateEvent(
      resolvedParams.eventId,
      parsed.data
    );

    return NextResponse.json(updatedEvent);
  } catch (error) {
    return handleError(error);
  }
}
