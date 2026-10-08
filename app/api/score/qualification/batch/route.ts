import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getBatchPlayerQualificationData } from '@/lib/services/qualification';
import { handleError, BadRequestError } from '@/lib/errors';
import { withScoringRateLimit, recordAccessCodeFailure } from '@/lib/middleware/rate-limit';

const batchRequestSchema = z.object({
  access_code: z.string().min(1).max(50),
  event_player_ids: z.array(z.string().uuid()).min(1).max(100),
});

/**
 * POST: Get qualification data for multiple players
 */
export async function POST(req: Request) {
  const rateLimitResponse = await withScoringRateLimit(req);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await req.json();
    const parsed = batchRequestSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request body');
    }

    const { access_code, event_player_ids } = parsed.data;

    // Use service to get batch player qualification data
    const result = await getBatchPlayerQualificationData(access_code, event_player_ids);

    return NextResponse.json(result);
  } catch (error) {
    await recordAccessCodeFailure(req, error);
    return handleError(error);
  }
}
