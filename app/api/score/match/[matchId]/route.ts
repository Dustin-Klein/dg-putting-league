import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getMatchForScoring,
  recordScoreAndGetMatch,
  completeMatchPublic,
} from '@/lib/services/scoring/public-scoring';
import { handleError, BadRequestError } from '@/lib/errors';
import { validateCsrfOrigin } from '@/lib/utils';

const getMatchSchema = z.object({
  access_code: z.string().min(1),
});

const recordScoreSchema = z.object({
  access_code: z.string().min(1),
  frame_number: z.number().min(1),
  event_player_id: z.string().uuid(),
  putts_made: z.number().min(0).max(3),
  // bonus_point_enabled is now determined server-side from the event record
});

const completeMatchSchema = z.object({
  access_code: z.string().min(1),
});

/**
 * POST: Get match details for scoring
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    validateCsrfOrigin(req);
    const { matchId } = await params;
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid match ID');
    }

    const body = await req.json();
    const parsed = getMatchSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Access code is required');
    }

    const match = await getMatchForScoring(parsed.data.access_code, bracketMatchId);
    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * PUT: Record a score
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    validateCsrfOrigin(req);
    const { matchId } = await params;
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid match ID');
    }

    const body = await req.json();
    const parsed = recordScoreSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid score data');
    }

    // Combined: record score AND get updated match with single client
    const match = await recordScoreAndGetMatch(
      parsed.data.access_code,
      bracketMatchId,
      parsed.data.frame_number,
      parsed.data.event_player_id,
      parsed.data.putts_made
    );

    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * PATCH: Complete match
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    validateCsrfOrigin(req);
    const { matchId } = await params;
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) {
      throw new BadRequestError('Invalid match ID');
    }

    const body = await req.json();
    const parsed = completeMatchSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Access code is required');
    }

    const match = await completeMatchPublic(parsed.data.access_code, bracketMatchId);
    return NextResponse.json(match);
  } catch (error) {
    return handleError(error);
  }
}
