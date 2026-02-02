import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getEventPayouts,
  updateEventPayouts,
  requireEventAdmin,
} from '@/lib/services/event';
import { handleError, BadRequestError } from '@/lib/errors';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    const payouts = await getEventPayouts(eventId);

    if (!payouts) {
      return NextResponse.json({ error: 'No entry fee set for this event' }, { status: 404 });
    }

    return NextResponse.json(payouts);
  } catch (error) {
    return handleError(error);
  }
}

const payoutStructureSchema = z.object({
  payout_structure: z
    .array(
      z.object({
        place: z.number().int().positive(),
        percentage: z.number().min(0).max(100),
      })
    )
    .nullable(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    await requireEventAdmin(eventId);

    const body = await req.json();
    const parsed = payoutStructureSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid payout structure');
    }

    await updateEventPayouts(eventId, parsed.data.payout_structure);

    const updatedPayouts = await getEventPayouts(eventId);
    return NextResponse.json(updatedPayouts);
  } catch (error) {
    return handleError(error);
  }
}
