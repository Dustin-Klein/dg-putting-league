import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getBatchPlayerQualificationData } from '@/lib/services/qualification';
import { handleError, BadRequestError } from '@/lib/errors';

const batchRequestSchema = z.object({
  access_code: z.string().min(1),
  event_player_ids: z.array(z.string()).min(1),
});

/**
 * POST: Get qualification data for multiple players
 */
export async function POST(req: Request) {
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
    return handleError(error);
  }
}
