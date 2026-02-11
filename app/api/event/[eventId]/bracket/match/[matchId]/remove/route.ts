import { NextResponse } from 'next/server';
import { z } from 'zod';
import { removeTeamFromMatch } from '@/lib/services/bracket';
import { handleError, BadRequestError } from '@/lib/errors';

const removeSchema = z.object({
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
    const parsed = removeSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request: slot (opponent1|opponent2) is required');
    }

    await removeTeamFromMatch(eventId, matchIdNum, parsed.data.slot);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
