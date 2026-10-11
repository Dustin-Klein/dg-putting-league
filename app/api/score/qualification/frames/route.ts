import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordQualificationScores } from '@/lib/services/qualification';
import { handleError, BadRequestError } from '@/lib/errors';
import { withScoringRateLimit, recordAccessCodeFailure } from '@/lib/middleware/rate-limit';
import { validateCsrfOrigin } from '@/lib/utils';

const recordFramesSchema = z.object({
  access_code: z.string().min(1).max(50),
  frame_number: z.number().int().min(1),
  scores: z
    .array(
      z.object({
        event_player_id: z.string().uuid(),
        putts_made: z.number().int().min(0).max(3),
      })
    )
    .min(1)
    .max(100),
});

/**
 * POST: Record one qualification frame for a group of players, all or nothing
 */
export async function POST(req: Request) {
  const rateLimitResponse = await withScoringRateLimit(req);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    validateCsrfOrigin(req);
    const body = await req.json();
    const parsed = recordFramesSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request body');
    }

    const result = await recordQualificationScores(
      parsed.data.access_code,
      parsed.data.frame_number,
      parsed.data.scores.map((score) => ({ eventPlayerId: score.event_player_id, puttsMade: score.putts_made }))
    );

    return NextResponse.json(result);
  } catch (error) {
    await recordAccessCodeFailure(req, error);
    return handleError(error);
  }
}
