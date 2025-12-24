import { NextResponse } from 'next/server';
import {
  getOrCreateMatchForBracket,
  getMatchByBracketMatchId,
} from '@/lib/match-scoring';
import { handleError, BadRequestError } from '@/lib/errors';

/**
 * GET: Get the detailed match record for a bracket match
 * POST: Create/get the match record for scoring
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

    const match = await getMatchByBracketMatchId(eventId, bracketMatchId);

    if (!match) {
      return NextResponse.json({ exists: false }, { status: 404 });
    }

    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  try {
    const { eventId, matchId } = await params;
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid bracket match ID');
    }

    const match = await getOrCreateMatchForBracket(eventId, bracketMatchId);
    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}
