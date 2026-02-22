import { NextRequest, NextResponse } from 'next/server';
import { getPublicMatchDetails } from '@/lib/services/scoring/public-scoring';
import { handleError } from '@/lib/errors';
import { withRateLimit } from '@/lib/middleware/rate-limit';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ eventId: string; matchId: string }> }
) {
  const rateLimitResponse = withRateLimit(request, 'public:bracket');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const params = await props.params;
    const { eventId, matchId } = params;

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(eventId)) {
      return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 });
    }

    const matchIdNum = parseInt(matchId, 10);
    if (isNaN(matchIdNum)) {
      return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
    }

    const match = await getPublicMatchDetails(eventId, matchIdNum);
    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}
