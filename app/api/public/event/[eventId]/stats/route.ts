import { NextRequest, NextResponse } from 'next/server';
import { getPublicEventStats } from '@/lib/services/event-stats';
import { handleError } from '@/lib/errors';
import { withPublicStatsRateLimit } from '@/lib/middleware/rate-limit';

/** The public event report; the live stats page polls this route. */
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ eventId: string }> }
) {
  const rateLimitResponse = await withPublicStatsRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { eventId } = await props.params;
    return NextResponse.json(await getPublicEventStats(eventId));
  } catch (error) {
    return handleError(error);
  }
}
