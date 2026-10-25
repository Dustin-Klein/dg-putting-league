import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BadRequestError, handleError } from '@/lib/errors';
import { getHandicapSettings, updateHandicapSettings } from '@/lib/services/handicap';
import { updateHandicapSettingsSchema } from '@/lib/services/handicap/schemas';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';
import { validateCsrfOrigin } from '@/lib/utils';

type RouteParams = { params: Promise<{ leagueId: string }> };

const paramsSchema = z.object({ leagueId: z.uuid('Invalid league ID') });

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { leagueId } = paramsSchema.parse(await params);
    return NextResponse.json(await getHandicapSettings(leagueId));
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const rateLimitResponse = await withStrictRateLimit(request, 'league:handicap:settings');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(request);
    const { leagueId } = paramsSchema.parse(await params);
    const parsed = updateHandicapSettingsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid request data');
    }
    return NextResponse.json(await updateHandicapSettings(leagueId, parsed.data));
  } catch (error) {
    return handleError(error);
  }
}
