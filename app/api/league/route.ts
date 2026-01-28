import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLeague } from '@/lib/services/league';
import { handleError, BadRequestError } from '@/lib/errors';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';

const createLeagueSchema = z.object({
  name: z.string().min(1).max(255),
  city: z.string().max(100).optional(),
});

export async function POST(request: NextRequest) {
  const rateLimitResponse = withStrictRateLimit(request, 'league:create');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new BadRequestError('Invalid JSON body');
    }

    const parsed = createLeagueSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid league data');
    }

    const league = await createLeague({
      name: parsed.data.name,
      city: parsed.data.city,
    });

    return NextResponse.json(league, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
