import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getEventWithPlayers,
  deleteEvent,
  updateEvent,
  validateEventStatusTransition,
} from '@/lib/event';
import {
  handleError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

const updateEventSchema = z.object({
  status: z.enum([
    'created',
    'pre-bracket',
    'bracket',
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
  _req: Request,
  { params }: { params: { eventId: string } | Promise<{ eventId: string }> }
) {
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
    
    // If updating status, perform validation
    if (parsed.data.status) {
      await validateEventStatusTransition(
        resolvedParams.eventId,
        parsed.data.status,
        currentEvent
      );
    }

    const updatedEvent = await updateEvent(
      resolvedParams.eventId,
      parsed.data
    );

    return NextResponse.json(updatedEvent);
  } catch (error) {
    return handleError(error);
  }
}
