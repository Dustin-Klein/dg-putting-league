import { NextResponse } from 'next/server';
import { releaseLane } from '@/lib/services/lane';
import { requireEventAdmin } from '@/lib/services/event';
import { handleError, BadRequestError } from '@/lib/errors';

/**
 * POST /api/event/[eventId]/lanes/[laneId]/release
 * Release a lane from its current match without auto-reassign
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string; laneId: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const { eventId } = resolvedParams;
    await requireEventAdmin(eventId);

    const body = await req.json();
    const matchId = body.matchId;

    if (typeof matchId !== 'number') {
      throw new BadRequestError('matchId must be a number');
    }

    const released = await releaseLane(eventId, matchId);

    if (!released) {
      throw new BadRequestError('Lane could not be released from this match');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
