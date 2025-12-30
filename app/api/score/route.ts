import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateAccessCode, getMatchesForScoring } from '@/lib/services/scoring/public-scoring';
import { handleError, BadRequestError } from '@/lib/errors';

const validateCodeSchema = z.object({
  access_code: z.string().min(1),
});

/**
 * POST: Validate access code and get event info with available matches
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = validateCodeSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Access code is required');
    }

    const event = await validateAccessCode(parsed.data.access_code);
    const matches = await getMatchesForScoring(parsed.data.access_code);

    return NextResponse.json({
      event,
      matches,
    });
  } catch (error) {
    return handleError(error);
  }
}
