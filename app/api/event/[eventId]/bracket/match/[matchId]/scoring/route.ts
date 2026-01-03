import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getBracketMatchWithDetails,
  recordScoreAdmin,
  completeBracketMatch,
  completeMatchWithFinalScores,
} from '@/lib/services/scoring/match-scoring';
import { handleError, BadRequestError } from '@/lib/errors';

const recordScoreSchema = z.object({
  frame_number: z.number().min(1),
  event_player_id: z.string().uuid(),
  putts_made: z.number().min(0).max(3),
});

const finalScoreSchema = z.object({
  team1_score: z.number().min(0),
  team2_score: z.number().min(0),
});

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

/**
 * POST: Complete match with final scores only (no frame data)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  try {
    const { eventId, matchId } = await params;
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid bracket match ID');
    }

    const body = await req.json();
    const parsed = finalScoreSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid score data');
    }

    const { team1_score, team2_score } = parsed.data;

    const match = await completeMatchWithFinalScores(
      eventId,
      bracketMatchId,
      team1_score,
      team2_score
    );

    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * PUT: Record a score for a player in a frame
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  try {
    const { eventId, matchId } = await params;
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid bracket match ID');
    }

    const body = await req.json();
    const parsed = recordScoreSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid score data');
    }

    const { frame_number, event_player_id, putts_made } = parsed.data;

    const updatedMatch = await recordScoreAdmin(
      eventId,
      bracketMatchId,
      frame_number,
      event_player_id,
      putts_made
    );

    return NextResponse.json(updatedMatch);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * PATCH: Complete the match
 */
export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  try {
    const { eventId, matchId } = await params;
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid bracket match ID');
    }

    const match = await completeBracketMatch(eventId, bracketMatchId);
    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}
