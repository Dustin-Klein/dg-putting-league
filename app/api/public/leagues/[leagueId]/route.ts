import { NextResponse } from 'next/server';
import { getPublicLeagueWithEvents } from '@/lib/services/league/league-service';
import { handleError } from '@/lib/errors';
import { withRateLimit } from '@/lib/middleware/rate-limit';

export async function GET(
  request: Request,
  props: { params: Promise<{ leagueId: string }> }
) {
  const rateLimitResponse = withRateLimit(request, 'public:league');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const params = await props.params;
    const { leagueId } = params;
    const league = await getPublicLeagueWithEvents(leagueId);
    return NextResponse.json(league);
  } catch (error) {
    return handleError(error);
  }
}
