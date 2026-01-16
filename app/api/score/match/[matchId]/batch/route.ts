import { NextResponse } from 'next/server';
import { z } from 'zod';
import { batchRecordScoresAndGetMatch } from '@/lib/services/scoring/public-scoring';
import { handleError, BadRequestError } from '@/lib/errors';

const batchRecordScoreSchema = z.object({
  access_code: z.string().min(1),
  frame_number: z.number().min(1),
  scores: z.array(z.object({
    event_player_id: z.string().uuid(),
    putts_made: z.number().min(0).max(3),
  })).max(4),
});

/**
 * PUT: Record multiple scores for a frame in one request
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid match ID');
    }

    const body = await req.json();
    const parsed = batchRecordScoreSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid batch score data');
    }

    const match = await batchRecordScoresAndGetMatch(
      parsed.data.access_code,
      bracketMatchId,
      parsed.data.frame_number,
      parsed.data.scores
    );

    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}
