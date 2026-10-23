import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleError } from '@/lib/errors';
import { getPlayerHandicap } from '@/lib/services/handicap';
import { withPublicBracketRateLimit } from '@/lib/middleware/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ leagueId: string; playerId: string }> };

const paramsSchema = z.object({
  leagueId: z.uuid('Invalid league ID'),
  playerId: z.uuid('Invalid player ID'),
});

/** Public: a player's zone, period stats and history. League admins also get notes and suggestions. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const rateLimitResponse = await withPublicBracketRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { leagueId, playerId } = paramsSchema.parse(await params);
    return NextResponse.json(await getPlayerHandicap(playerId, leagueId));
  } catch (error) {
    return handleError(error);
  }
}
