import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  updateMatchResult,
  assignLaneToMatch,
} from '@/lib/services/bracket';
import { requireEventAdmin } from '@/lib/services/event';
import { handleError, BadRequestError } from '@/lib/errors';
import { validateCsrfOrigin } from '@/lib/utils';

const updateMatchSchema = z.object({
  opponent1Score: z.number().min(0).optional(),
  opponent2Score: z.number().min(0).optional(),
  winnerId: z.number().nullable().optional(),
  laneId: z.string().uuid().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  try {
    validateCsrfOrigin(req);
    const { eventId, matchId } = await params;
    await requireEventAdmin(eventId);
    const matchIdNum = parseInt(matchId, 10);

    if (isNaN(matchIdNum)) {
      throw new BadRequestError('Invalid match ID');
    }

    const body = await req.json();
    const parsed = updateMatchSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data');
    }

    const { opponent1Score, opponent2Score, winnerId, laneId } = parsed.data;

    // Handle lane assignment
    if (laneId) {
      await assignLaneToMatch(eventId, matchIdNum, laneId);
    }

    // Handle score update
    if (opponent1Score !== undefined && opponent2Score !== undefined) {
      const updatedMatch = await updateMatchResult(
        eventId,
        matchIdNum,
        opponent1Score,
        opponent2Score,
        winnerId
      );
      return NextResponse.json(updatedMatch);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
