import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getEventWithPlayers,
  deleteEvent,
  updateEvent,
  validateEventStatusTransition,
} from '@/lib/event';
import { splitPlayersIntoPools } from '@/lib/event-player';
import { generateTeams } from '@/lib/team';
import { createBracket } from '@/lib/bracket';
import {
  handleError,
  BadRequestError,
} from '@/lib/errors';

const updateEventSchema = z.object({
  status: z.enum([
    'created',
    'pre-bracket',
    'bracket',
    'completed',
  ]).optional(),
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
      if (currentEvent.status === 'pre-bracket' && parsed.data.status === 'bracket') {
        // Note: Ideally these sequential operations would be wrapped in a database
        // function (RPC) to ensure atomicity. The current implementation uses
        // idempotent operations as a fallback - each step checks if already done.

        // 1. Split players into pools
        try {
          await splitPlayersIntoPools(resolvedParams.eventId);
        } catch (error) {
          if (!(error instanceof BadRequestError && error.message.includes('already been assigned'))) {
            throw error;
          }
        }

        // 2. Generate teams
        try {
          await generateTeams(resolvedParams.eventId);
        } catch (error) {
          if (!(error instanceof BadRequestError && error.message.includes('already been generated'))) {
            throw error;
          }
        }

        // 3. Generate bracket
        try {
          await createBracket(resolvedParams.eventId, true);
        } catch (error) {
          if (!(error instanceof BadRequestError && error.message.includes('already been created'))) {
            throw error;
          }
        }
      }
    }

    // Update event status (happens for all valid status changes)
    const updatedEvent = await updateEvent(
      resolvedParams.eventId,
      parsed.data
    );

    return NextResponse.json(updatedEvent);
  } catch (error) {
    return handleError(error);
  }
}
