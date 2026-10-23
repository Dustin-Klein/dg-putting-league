import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BadRequestError, handleError } from '@/lib/errors';
import { getPlayerHandicapsByNumber } from '@/lib/services/handicap';
import { withPublicBracketRateLimit } from '@/lib/middleware/rate-limit';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ playerNumber: string }> };

/** Public: the player's handicap in every league where they have a zone. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const rateLimitResponse = await withPublicBracketRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { playerNumber } = await params;
    const parsed = z.coerce.number().int().positive().safeParse(playerNumber);
    if (!parsed.success) throw new BadRequestError('Invalid player number');
    return NextResponse.json({ leagues: await getPlayerHandicapsByNumber(parsed.data) });
  } catch (error) {
    return handleError(error);
  }
}
