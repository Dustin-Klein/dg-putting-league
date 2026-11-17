import { NextRequest, NextResponse } from 'next/server';
import { getSecondChanceRoster, syncSecondChancePlayers } from '@/lib/services/event';
import { handleError } from '@/lib/errors';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';

/** A second-chance event's roster against who is out of the main event. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;
    return NextResponse.json(await getSecondChanceRoster(eventId));
  } catch (error) {
    return handleError(error);
  }
}

/** Enter every player knocked out of the main event since the last sync. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const rateLimitResponse = await withStrictRateLimit(req, 'event:second-chance-sync');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { eventId } = await params;
    return NextResponse.json(await syncSecondChancePlayers(eventId));
  } catch (error) {
    return handleError(error);
  }
}
