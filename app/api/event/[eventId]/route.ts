import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getEventWithPlayers,
  deleteEvent,
  updateEvent,
} from '@/lib/event';
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/errors';

const updateEventSchema = z.object({
  status: z.enum([
    'registration',
    'qualification',
    'bracket',
    'completed',
  ]).optional(),
});

function handleError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  console.error(error);
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  );
}

export async function GET(
  _req: Request,
  { params }: { params: { eventId: string } }
) {
  try {
    const event = await getEventWithPlayers(params.eventId);
    return NextResponse.json(event);
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(
  req: Request,
  context: { params: { eventId: string } | Promise<{ eventId: string }> }
) {
  const { eventId } = await Promise.resolve(context.params);
  
  try {
    await deleteEvent(eventId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleError(e);
  }
}


export async function PATCH(
  req: Request,
  { params }: { params: { eventId: string } }
) {
  try {
    const body = await req.json();
    const parsed = updateEventSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request data', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const updatedEvent = await updateEvent(
      params.eventId,
      parsed.data
    );

    return NextResponse.json(updatedEvent);
  } catch (e) {
    return handleError(e);
  }
}
