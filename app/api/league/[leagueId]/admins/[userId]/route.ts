import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleError } from '@/lib/errors';
import { validateCsrfOrigin } from '@/lib/utils';
import { requireLeagueAdmin } from '@/lib/services/auth';
import { removeLeagueAdmin } from '@/lib/services/league';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';

type RouteParams = { params: Promise<{ leagueId: string; userId: string }> };

const paramsSchema = z.object({
  leagueId: z.uuid("Invalid league ID"),
  userId: z.uuid("Invalid user ID"),
});

export async function DELETE(
  request: Request,
  { params }: RouteParams
) {
  const rateLimitResponse = withStrictRateLimit(request, 'league:admins:remove');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(request);
    const { leagueId, userId } = paramsSchema.parse(await params);
    await requireLeagueAdmin(leagueId);

    await removeLeagueAdmin(leagueId, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
