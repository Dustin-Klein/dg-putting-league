import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getOrCreateFrame,
  recordFullFrame,
  RecordFrameResultInput,
} from '@/lib/match-scoring';
import { handleError, BadRequestError } from '@/lib/errors';

const frameResultSchema = z.object({
  event_player_id: z.string().uuid(),
  putts_made: z.number().min(0).max(3),
  points_earned: z.number().min(0).max(4),
  order_in_frame: z.number().min(1),
});

const createFrameSchema = z.object({
  frame_number: z.number().min(1),
  is_overtime: z.boolean().optional().default(false),
  results: z.array(frameResultSchema).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  try {
    const { eventId, matchId } = await params;
    const body = await req.json();
    const parsed = createFrameSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data');
    }

    const { frame_number, is_overtime, results } = parsed.data;

    if (results && results.length > 0) {
      // Record full frame with results
      const frame = await recordFullFrame(
        eventId,
        matchId,
        frame_number,
        results as RecordFrameResultInput[],
        is_overtime
      );
      return NextResponse.json(frame);
    } else {
      // Just create/get the frame
      const frame = await getOrCreateFrame(eventId, matchId, frame_number, is_overtime);
      return NextResponse.json(frame);
    }
  } catch (error) {
    return handleError(error);
  }
}
