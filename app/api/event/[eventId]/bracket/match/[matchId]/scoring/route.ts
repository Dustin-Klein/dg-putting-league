import { NextResponse } from 'next/server';
import { getBracketMatchWithDetails } from '@/lib/services/scoring/match-scoring';
import { handleError, BadRequestError } from '@/lib/errors';

/**
 * GET: Get the detailed bracket match record for scoring
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  try {
    const { eventId, matchId } = await params;
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid bracket match ID');
    }

    const match = await getBracketMatchWithDetails(eventId, bracketMatchId);
    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}
