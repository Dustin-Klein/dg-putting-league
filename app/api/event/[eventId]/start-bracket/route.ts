import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getEventWithPlayers,
  transitionEventToBracket,
} from '@/lib/services/event';
import { handleError, BadRequestError } from '@/lib/errors';
import { withStrictRateLimit } from '@/lib/middleware/rate-limit';

const teamMemberSchema = z.object({
  eventPlayerId: z.string(),
  role: z.enum(['A_pool', 'B_pool']),
});

const startBracketSchema = z.object({
  poolAssignments: z.array(
    z.object({
      eventPlayerId: z.string(),
      playerId: z.string(),
      playerName: z.string(),
      pool: z.enum(['A', 'B']),
      pfaScore: z.number(),
      scoringMethod: z.enum(['qualification', 'pfa', 'default']),
      defaultPool: z.enum(['A', 'B']),
    })
  ),
  teamPairings: z.array(
    z.object({
      seed: z.number(),
      poolCombo: z.string(),
      combinedScore: z.number(),
      members: z.array(teamMemberSchema),
    })
  ),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const rateLimitResponse = withStrictRateLimit(req, 'event:start-bracket');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await req.json();
    const parsed = startBracketSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data');
    }

    const { eventId } = await params;
    const event = await getEventWithPlayers(eventId);

    if (event.status !== 'pre-bracket') {
      throw new BadRequestError(
        'Event must be in pre-bracket status to start bracket'
      );
    }

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
