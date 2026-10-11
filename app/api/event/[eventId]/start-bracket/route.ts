import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getEventWithPlayers,
  transitionEventToBracket,
} from '@/lib/services/event';
import { handleError, BadRequestError } from '@/lib/errors';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';

const teamMemberSchema = z.object({
  eventPlayerId: z.string(),
  slot: z.number().int().min(1),
});

const startBracketSchema = z.object({
  poolAssignments: z.array(
    z.object({
      eventPlayerId: z.string(),
      pool: z.enum(['A', 'B']),
      playerId: z.string().optional(),
      playerName: z.string().optional(),
      pfaScore: z.number().optional(),
      scoringMethod: z.enum(['qualification', 'pfa', 'default']).optional(),
      defaultPool: z.enum(['A', 'B']).optional(),
    })
  ).optional(),
  teamPairings: z.array(
    z.object({
      seed: z.number().optional(),
      poolCombo: z.string().optional(),
      combinedScore: z.number().optional(),
      members: z.array(teamMemberSchema),
    })
  ).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const rateLimitResponse = await withStrictRateLimit(req, 'event:start-bracket');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await req.json();
    const parsed = startBracketSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data');
    }

    const { eventId } = await params;
    const event = await getEventWithPlayers(eventId);

    await transitionEventToBracket(
      eventId,
      event,
      parsed.data.poolAssignments,
      parsed.data.teamPairings
    );

    const updatedEvent = await getEventWithPlayers(eventId);
    return NextResponse.json(updatedEvent);
  } catch (error) {
    return handleError(error);
  }
}
