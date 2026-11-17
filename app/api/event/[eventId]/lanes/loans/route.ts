import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getLaneLoans, lendLanes, returnLanes } from '@/lib/services/lane';
import { BadRequestError, handleError } from '@/lib/errors';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';

const loanSchema = z.object({
  action: z.enum(['lend', 'return']),
  laneIds: z.array(z.uuid()).min(1).max(50),
});

/** Lanes this event has lent to its second chance, or borrowed from its main event. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    return NextResponse.json(await getLaneLoans(eventId));
  } catch (error) {
    return handleError(error);
  }
}

/** Lend lanes to the second chance (main event only), or return them (either side). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const rateLimitResponse = await withStrictRateLimit(req, 'event:lane-loans');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await req.json().catch(() => {
      throw new BadRequestError('Invalid JSON body');
    });
    const parsed = loanSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestError('Invalid request data');

    const { eventId } = await params;
    if (parsed.data.action === 'lend') {
      await lendLanes(eventId, parsed.data.laneIds);
    } else {
      await returnLanes(eventId, parsed.data.laneIds);
    }
    return NextResponse.json(await getLaneLoans(eventId));
  } catch (error) {
    return handleError(error);
  }
}
