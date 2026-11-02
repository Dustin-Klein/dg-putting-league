import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BadRequestError, handleError } from '@/lib/errors';
import { moveEntryZone } from '@/lib/services/handicap';
import { setPlayerZoneSchema } from '@/lib/services/handicap/schemas';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';
import { validateCsrfOrigin } from '@/lib/utils';

type RouteParams = { params: Promise<{ eventId: string; eventPlayerId: string }> };

const paramsSchema = z.object({
  eventId: z.uuid('Invalid event ID'),
  eventPlayerId: z.uuid('Invalid event player ID'),
});

/** Event admin: move an entry's player to a zone (league-wide, and tonight before their first frame). */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const rateLimitResponse = await withStrictRateLimit(request, 'event:handicap:zone');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(request);
    const { eventId, eventPlayerId } = paramsSchema.parse(await params);
    const parsed = setPlayerZoneSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid request data');
    }
    return NextResponse.json(await moveEntryZone(eventId, eventPlayerId, parsed.data.zone, parsed.data.note));
  } catch (error) {
    return handleError(error);
  }
}
