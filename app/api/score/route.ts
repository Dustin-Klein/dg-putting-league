import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getEventScoringContext } from '@/lib/services/scoring/public-scoring';
import { handleError, BadRequestError } from '@/lib/errors';
import { validateCsrfOrigin } from '@/lib/utils';

const validateCodeSchema = z.object({
  access_code: z.string().min(1).max(50),
});

/**
 * POST: Validate access code and get event info
 * Returns different data based on event status:
 * - pre-bracket + qualification_round_enabled: players for qualification
 * - bracket: matches for scoring
 */
export async function POST(req: Request) {
  try {
    validateCsrfOrigin(req);
    const body = await req.json();
    const parsed = validateCodeSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Access code is required');
    }

    const accessCode = parsed.data.access_code;
    const result = await getEventScoringContext(accessCode);

    return NextResponse.json(result);
  } catch (error) {
    return handleError(error);
  }
}
