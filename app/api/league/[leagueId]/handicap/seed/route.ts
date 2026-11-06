import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BadRequestError, handleError } from '@/lib/errors';
import { getZoneSeedCandidates, seedPlayerZones } from '@/lib/services/handicap';
import { seedZonesSchema } from '@/lib/services/handicap/schemas';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';
import { validateCsrfOrigin } from '@/lib/utils';

type RouteParams = { params: Promise<{ leagueId: string }> };

const paramsSchema = z.object({ leagueId: z.uuid('Invalid league ID') });
const sourceSchema = z.uuid('Invalid source league ID').optional();

/** League admin: the field's past scoring, for setting starting zones. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { leagueId } = paramsSchema.parse(await params);
    const source = sourceSchema.parse(request.nextUrl.searchParams.get('source_league_id') ?? undefined);
    return NextResponse.json(await getZoneSeedCandidates(leagueId, source));
  } catch (error) {
    return handleError(error);
  }
}

/** League admin: set starting zones for players who have not putted in the league. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const rateLimitResponse = await withStrictRateLimit(request, 'league:handicap:seed');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(request);
    const { leagueId } = paramsSchema.parse(await params);
    const parsed = seedZonesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid request data');
    }
    return NextResponse.json(await seedPlayerZones(leagueId, parsed.data.assignments, parsed.data.note));
  } catch (error) {
    return handleError(error);
  }
}
