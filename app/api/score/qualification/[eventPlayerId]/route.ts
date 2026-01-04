import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getPlayerQualificationData,
  recordQualificationScore,
} from '@/lib/services/qualification';
import { handleError, BadRequestError } from '@/lib/errors';

const recordScoreSchema = z.object({
  access_code: z.string().min(1),
  frame_number: z.number().int().min(1),
  putts_made: z.number().int().min(0).max(3),
});

/**
 * GET: Get qualification data for a specific player
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ eventPlayerId: string }> }
) {
  try {
    const { eventPlayerId } = await params;
    const { searchParams } = new URL(req.url);
    const accessCode = searchParams.get('access_code');

    if (!accessCode) {
      throw new BadRequestError('Access code is required');
    }

    const data = await getPlayerQualificationData(accessCode, eventPlayerId);

    return NextResponse.json(data);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST: Record a qualification score for a player
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventPlayerId: string }> }
) {
  try {
    const { eventPlayerId } = await params;
    const body = await req.json();
    const parsed = recordScoreSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request body');
    }

    const result = await recordQualificationScore(
      parsed.data.access_code,
      eventPlayerId,
      parsed.data.frame_number,
      parsed.data.putts_made
    );

    return NextResponse.json(result);
  } catch (error) {
    return handleError(error);
  }
}
