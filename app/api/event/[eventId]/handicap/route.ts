import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BadRequestError, handleError } from '@/lib/errors';
import { getEventHandicap, updateEventZoneDistances } from '@/lib/services/handicap';
import { eventZoneDistancesSchema } from '@/lib/services/handicap/schemas';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';
import { validateCsrfOrigin } from '@/lib/utils';

type RouteParams = { params: Promise<{ eventId: string }> };

const paramsSchema = z.object({ eventId: z.uuid('Invalid event ID') });

/** Event admin: tonight's zone distances and, once completed, the evaluation summary. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { eventId } = paramsSchema.parse(await params);
    return NextResponse.json(await getEventHandicap(eventId));
  } catch (error) {
    return handleError(error);
  }
}

/** Event admin: set tonight's zone distances (until the first frame is recorded). */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const rateLimitResponse = await withStrictRateLimit(request, 'event:handicap:distances');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(request);
    const { eventId } = paramsSchema.parse(await params);
    const parsed = eventZoneDistancesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid request data');
    }
    return NextResponse.json(await updateEventZoneDistances(eventId, parsed.data.zones));
  } catch (error) {
    return handleError(error);
  }
}
