import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleError } from '@/lib/errors';
import { validateCsrfOrigin } from '@/lib/utils';
import { requireLeagueAdmin } from '@/lib/services/auth';
import { getLeagueAdminsForOwner, addLeagueAdmin } from '@/lib/services/league';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';

type RouteParams = { params: Promise<{ leagueId: string }> | { leagueId: string } };

const paramsSchema = z.object({
  leagueId: z.uuid("Invalid league ID"),
});

const postSchema = z.object({
  email: z.email("Invalid email format."),
});

export async function GET(
  request: Request,
  { params: paramsPromise }: RouteParams
) {
  try {
    const params = await Promise.resolve(paramsPromise);
    const { leagueId } = paramsSchema.parse(params);
    await requireLeagueAdmin(leagueId);
    const admins = await getLeagueAdminsForOwner(leagueId);
    return NextResponse.json({ admins });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  request: Request,
  { params: paramsPromise }: RouteParams
) {
  const rateLimitResponse = withStrictRateLimit(request, 'league:admins:add');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(request);
    const params = await Promise.resolve(paramsPromise);
    const { leagueId } = paramsSchema.parse(params);
    const body = await request.json();
    const { email } = postSchema.parse(body);

    await addLeagueAdmin(leagueId, email);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
