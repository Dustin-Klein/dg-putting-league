import { NextResponse } from 'next/server';
import { z } from 'zod';
import { manuallyAdvanceTeam } from '@/lib/services/bracket';
import { handleError, BadRequestError } from '@/lib/errors';

const advanceSchema = z.object({
  participant_id: z.number().int().positive(),
  slot: z.enum(['opponent1', 'opponent2']),
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
    const parsed = advanceSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request: participant_id (number) and slot (opponent1|opponent2) are required');
    }

    await manuallyAdvanceTeam(eventId, matchIdNum, parsed.data.participant_id, parsed.data.slot);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
