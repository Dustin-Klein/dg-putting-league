import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getBracketMatchWithDetails,
  recordScoreAdmin,
  completeBracketMatch,
  completeMatchWithFinalScores,
  correctMatchScores,
  clearScoreOverride,
} from '@/lib/services/scoring/match-scoring';
import { requireEventAdmin } from '@/lib/services/event';
import { handleError, BadRequestError } from '@/lib/errors';
import { MAX_FRAME_NUMBER } from '@/lib/services/scoring/score-submission';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';

export const recordScoreSchema = z.object({
  frame_number: z.number().int().min(1).max(MAX_FRAME_NUMBER),
  event_player_id: z.string().uuid(),
  putts_made: z.number().int().min(0).max(3),
});

export const finalScoreSchema = z.object({
  team1_score: z.number().int().min(0),
  team2_score: z.number().int().min(0),
  is_correction: z.boolean().optional(),
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
    await requireEventAdmin(eventId);
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
    await requireEventAdmin(eventId);
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid bracket match ID');
    }

    const body = await req.json();
    const parsed = finalScoreSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid score data');
    }

    const { team1_score, team2_score, is_correction } = parsed.data;

    const match = is_correction
      ? await correctMatchScores(eventId, bracketMatchId, team1_score, team2_score)
      : await completeMatchWithFinalScores(eventId, bracketMatchId, team1_score, team2_score);

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
    await requireEventAdmin(eventId);
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
    await requireEventAdmin(eventId);
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

/** DELETE: Clear a manual score override and restore frame-derived totals. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ eventId: string; matchId: string }> }
) {
  const rateLimitResponse = await withStrictRateLimit(req, 'event:clear-score-override');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { eventId, matchId } = await params;
    const bracketMatchId = parseInt(matchId, 10);
    if (isNaN(bracketMatchId)) throw new BadRequestError('Invalid bracket match ID');

    const match = await clearScoreOverride(eventId, bracketMatchId);
    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}
