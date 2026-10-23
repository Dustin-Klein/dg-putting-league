import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BadRequestError, handleError } from '@/lib/errors';
import { setPlayerZone } from '@/lib/services/handicap';
import { setPlayerZoneSchema } from '@/lib/services/handicap/schemas';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';
import { validateCsrfOrigin } from '@/lib/utils';

type RouteParams = { params: Promise<{ leagueId: string; playerId: string }> };

const paramsSchema = z.object({
  leagueId: z.uuid('Invalid league ID'),
  playerId: z.uuid('Invalid player ID'),
});

/** League admin: put a player in a zone (future events only), with a required note. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const rateLimitResponse = await withStrictRateLimit(request, 'league:handicap:zone');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(request);
    const { leagueId, playerId } = paramsSchema.parse(await params);
    const parsed = setPlayerZoneSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid request data');
    }
    return NextResponse.json(await setPlayerZone(leagueId, playerId, parsed.data.zone, parsed.data.note));
  } catch (error) {
    return handleError(error);
  }
}
