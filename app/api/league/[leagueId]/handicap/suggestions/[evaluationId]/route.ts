import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { BadRequestError, handleError } from '@/lib/errors';
import { resolveZoneSuggestion } from '@/lib/services/handicap';
import { resolveSuggestionSchema } from '@/lib/services/handicap/schemas';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';
import { validateCsrfOrigin } from '@/lib/utils';

type RouteParams = { params: Promise<{ leagueId: string; evaluationId: string }> };

const paramsSchema = z.object({
  leagueId: z.uuid('Invalid league ID'),
  evaluationId: z.uuid('Invalid suggestion ID'),
});

/** Apply or dismiss a demotion suggestion. 409 when the player has moved on since. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const rateLimitResponse = await withStrictRateLimit(request, 'league:handicap:suggestion');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(request);
    const { leagueId, evaluationId } = paramsSchema.parse(await params);
    const parsed = resolveSuggestionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid request data');
    }
    await resolveZoneSuggestion(leagueId, evaluationId, parsed.data.action, parsed.data.note ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
