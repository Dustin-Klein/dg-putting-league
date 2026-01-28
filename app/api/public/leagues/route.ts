import { NextRequest, NextResponse } from 'next/server';
import { getPublicLeagues } from '@/lib/services/league/league-service';
import { handleError } from '@/lib/errors';
import { withRateLimit } from '@/lib/middleware/rate-limit';

export async function GET(request: NextRequest) {
  const rateLimitResponse = withRateLimit(request, 'public:leagues');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const leagues = await getPublicLeagues();
    return NextResponse.json(leagues);
  } catch (error) {
    return handleError(error);
  }
}
