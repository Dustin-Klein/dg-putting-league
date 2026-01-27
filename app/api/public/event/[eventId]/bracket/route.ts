import { NextResponse } from 'next/server';
import { getPublicBracket } from '@/lib/services/bracket/bracket-service';
import { handleError } from '@/lib/errors';
import { withRateLimit } from '@/lib/middleware/rate-limit';

export async function GET(
  request: Request,
  props: { params: Promise<{ eventId: string }> }
) {
  const rateLimitResponse = withRateLimit(request, 'public:bracket');
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
