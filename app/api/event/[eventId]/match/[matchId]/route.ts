import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getBracketMatchWithDetails,
  startBracketMatch,
  completeBracketMatch,
} from '@/lib/services/scoring/match-scoring';
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
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid match ID');
    }

    const match = await getBracketMatchWithDetails(eventId, bracketMatchId);
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
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid match ID');
    }

    const body = await req.json();
    const parsed = updateMatchSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data');
    }

    let match;
    switch (parsed.data.action) {
      case 'start':
        match = await startBracketMatch(eventId, bracketMatchId);
        break;
      case 'complete':
        match = await completeBracketMatch(eventId, bracketMatchId);
        break;
      default:
        throw new BadRequestError('Invalid action');
    }

    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}
