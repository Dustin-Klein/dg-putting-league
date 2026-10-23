import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BadRequestError, handleError } from '@/lib/errors';
import { updateEntryHandicap } from '@/lib/services/handicap';
import { entryHandicapSchema } from '@/lib/services/handicap/schemas';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';
import { validateCsrfOrigin } from '@/lib/utils';

type RouteParams = { params: Promise<{ eventId: string; eventPlayerId: string }> };

const paramsSchema = z.object({
  eventId: z.uuid('Invalid event ID'),
  eventPlayerId: z.uuid('Invalid event player ID'),
});

/** Event admin: one entry's distance override (before its first frame) and handicap exclusion. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const rateLimitResponse = await withStrictRateLimit(request, 'event:handicap:entry');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(request);
    const { eventId, eventPlayerId } = paramsSchema.parse(await params);
    const parsed = entryHandicapSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid request data');
    }
    await updateEntryHandicap(eventId, eventPlayerId, parsed.data);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
