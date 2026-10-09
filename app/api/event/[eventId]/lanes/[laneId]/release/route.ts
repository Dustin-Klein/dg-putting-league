import { NextResponse } from 'next/server';
import { z } from 'zod';
import { releaseLane } from '@/lib/services/lane';
import { requireEventAdmin } from '@/lib/services/event';
import { handleError, BadRequestError } from '@/lib/errors';
import { validateCsrfOrigin } from '@/lib/utils';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';

export const releaseLaneSchema = z.object({
  matchId: z.number().int(),
  force: z.boolean().optional(),
});

/**
 * POST /api/event/[eventId]/lanes/[laneId]/release
 * Release a lane from its current match without auto-reassign
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string; laneId: string }> }
) {
  const rateLimitResponse = await withStrictRateLimit(req, 'event:lane-release');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(req);
    const resolvedParams = await params;
    const { eventId, laneId } = resolvedParams;
    await requireEventAdmin(eventId);

    const body = await req.json();
    const parsed = releaseLaneSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request data');
    }

    const released = await releaseLane(eventId, laneId, parsed.data.matchId, parsed.data.force);

    if (!released) {
      throw new BadRequestError('Lane could not be released from this match');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
