import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getEventWithPlayers,
  deleteEvent,
  updateEvent,
  validateEventStatusTransition,
  transitionEventToBracket,
  finalizeEventPlacements,
} from '@/lib/services/event';
import {
  handleError,
  BadRequestError,
} from '@/lib/errors';

const poolAssignmentSchema = z.object({
  eventPlayerId: z.string(),
  playerId: z.string(),
  playerName: z.string(),
  pool: z.enum(['A', 'B']),
  pfaScore: z.number(),
  scoringMethod: z.enum(['qualification', 'pfa', 'default']),
  defaultPool: z.enum(['A', 'B']),
});

const teamMemberSchema = z.object({
  eventPlayerId: z.string(),
  role: z.enum(['A_pool', 'B_pool']),
});

const teamPairingSchema = z.object({
  seed: z.number(),
  poolCombo: z.string(),
  combinedScore: z.number(),
  members: z.array(teamMemberSchema),
});

const updateEventSchema = z.object({
  status: z.enum([
    'created',
    'pre-bracket',
    'bracket',
    'completed',
  ]).optional(),
  poolAssignments: z.array(poolAssignmentSchema).optional(),
  teamPairings: z.array(teamPairingSchema).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const event = await getEventWithPlayers(resolvedParams.eventId);
    return NextResponse.json(event);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { eventId: string } | Promise<{ eventId: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    await deleteEvent(resolvedParams.eventId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}


export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const body = await req.json();
    const parsed = updateEventSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request data');
    }

    const resolvedParams = await Promise.resolve(params);
    
    // Get current event with players for validation
    const currentEvent = await getEventWithPlayers(resolvedParams.eventId);
    
    // If updating status, perform validation
    if (parsed.data.status) {
      await validateEventStatusTransition(
        resolvedParams.eventId,
        parsed.data.status,
        currentEvent
      );

      // If transitioning from pre-bracket to bracket, perform setup steps
      // (transitionEventToBracket handles the status update internally)
      if (currentEvent.status === 'pre-bracket' && parsed.data.status === 'bracket') {
        await transitionEventToBracket(
          resolvedParams.eventId,
          currentEvent,
          parsed.data.poolAssignments,
          parsed.data.teamPairings
        );
        const updatedEvent = await getEventWithPlayers(resolvedParams.eventId);
        return NextResponse.json(updatedEvent);
      }

      // If transitioning to completed, finalize and store placements
      if (currentEvent.status === 'bracket' && parsed.data.status === 'completed') {
        await finalizeEventPlacements(resolvedParams.eventId);
      }
    }

    // Update event status (happens for all other valid status changes)
    const updatedEvent = await updateEvent(
      resolvedParams.eventId,
      parsed.data
    );

    return NextResponse.json(updatedEvent);
  } catch (error) {
    return handleError(error);
  }
}
