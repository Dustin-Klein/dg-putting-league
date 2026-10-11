import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getEventForViewer,
  deleteEvent,
  updateEventSettings,
} from '@/lib/services/event';
import {
  handleError,
  BadRequestError,
} from '@/lib/errors';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';
import { validateCsrfOrigin } from '@/lib/utils';
import { TEAM_SIZE_MAX, TEAM_SIZE_MIN } from '@/lib/types/event';

const updateEventSchema = z.object({
  status: z.enum([
    'created',
    'pre-bracket',
    'completed',
  ]).optional(),
  double_grand_final: z.boolean().optional(),
  team_size: z.number().int().min(TEAM_SIZE_MIN).max(TEAM_SIZE_MAX).optional(),
  team_assignment: z.enum(['random_pairing', 'random_flat', 'manual']).optional(),
  force: z.boolean().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const resolvedParams = await params;
    const event = await getEventForViewer(resolvedParams.eventId);
    return NextResponse.json(event);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const rateLimitResponse = await withStrictRateLimit(request, 'event:delete');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(request);
    const resolvedParams = await params;
    await deleteEvent(resolvedParams.eventId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}


export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const rateLimitResponse = await withStrictRateLimit(req, 'event:update');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await req.json();
    const parsed = updateEventSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data');
    }

    validateCsrfOrigin(req);
    const resolvedParams = await params;
    const updatedEvent = await updateEventSettings(
      resolvedParams.eventId,
      parsed.data
    );

    return NextResponse.json(updatedEvent);
  } catch (error) {
    return handleError(error);
  }
}
