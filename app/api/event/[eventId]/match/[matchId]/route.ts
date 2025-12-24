import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getMatchWithDetails,
  startMatch,
  completeMatch,
} from '@/lib/match-scoring';
import { handleError, BadRequestError } from '@/lib/errors';

const updateMatchSchema = z.object({
  action: z.enum(['start', 'complete']),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  try {
    const { eventId, matchId } = await params;
    const match = await getMatchWithDetails(eventId, matchId);
    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  try {
    const { eventId, matchId } = await params;
    const body = await req.json();
    const parsed = updateMatchSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data');
    }

    let match;
    switch (parsed.data.action) {
      case 'start':
        match = await startMatch(eventId, matchId);
        break;
      case 'complete':
        match = await completeMatch(eventId, matchId);
        break;
      default:
        throw new BadRequestError('Invalid action');
    }

    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}
