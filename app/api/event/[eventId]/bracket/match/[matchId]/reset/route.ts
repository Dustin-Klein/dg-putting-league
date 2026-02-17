import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resetMatchResult } from '@/lib/services/bracket';
import { handleError, BadRequestError } from '@/lib/errors';

const resetWorkflowSchema = z.object({
  correction_reason: z.string().trim().min(3).max(500),
  winner_change_verified: z.literal(true),
  teams_notified: z.literal(true),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  try {
    const { eventId, matchId } = await params;
    const matchIdNum = parseInt(matchId, 10);

    if (isNaN(matchIdNum)) {
      throw new BadRequestError('Invalid match ID');
    }

    const body = await req.json();
    const parsed = resetWorkflowSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Reset requires verification, notifications, and a correction reason');
    }

    const resetResult = await resetMatchResult(eventId, matchIdNum, {
      correctionReason: parsed.data.correction_reason,
      winnerChangeVerified: parsed.data.winner_change_verified,
      teamsNotified: parsed.data.teams_notified,
    });

    return NextResponse.json(resetResult);
  } catch (error) {
    return handleError(error);
  }
}
