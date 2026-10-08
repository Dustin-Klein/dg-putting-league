import { NextRequest, NextResponse } from 'next/server';
import { getPublicBracket } from '@/lib/services/bracket/bracket-service';
import { handleError } from '@/lib/errors';
import { withPublicBracketRateLimit } from '@/lib/middleware/rate-limit';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ eventId: string }> }
) {
  const rateLimitResponse = await withPublicBracketRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const params = await props.params;
    const { eventId } = params;
    const bracket = await getPublicBracket(eventId);
    return NextResponse.json(bracket);
  } catch (error) {
    return handleError(error);
  }
}
