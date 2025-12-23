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
import { createBracket, bracketExists } from '@/lib/bracket';
import {
  handleError,
  BadRequestError,
} from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

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
      
      // If transitioning from pre-bracket to bracket, split players into pools and generate teams
      if (currentEvent.status === 'pre-bracket' && parsed.data.status === 'bracket') {
        try {
          // Try to split players into pools (might fail if already done)
          await splitPlayersIntoPools(resolvedParams.eventId);
        } catch (error) {
          // If pools are already assigned, that's okay - continue to team generation
          if (!(error instanceof BadRequestError && error.message.includes('Players have already been assigned to pools'))) {
            throw error;
          }
        }
        
        // Generate teams first (this will fail if teams already exist, which is okay)
        try {
          await generateTeams(resolvedParams.eventId);
        } catch (error) {
          // If teams already exist, that's okay - just continue
          if (!(error instanceof BadRequestError && error.message.includes('Teams have already been generated for this event'))) {
            throw error;
          }
        }

        // Update event status first so bracket creation can check status
        const updatedEvent = await updateEvent(
          resolvedParams.eventId,
          parsed.data
        );

        // Generate bracket after teams are created
        try {
          const hasBracket = await bracketExists(resolvedParams.eventId);
          if (!hasBracket) {
            await createBracket(resolvedParams.eventId);
          }
        } catch (error) {
          // If bracket already exists, that's okay - just continue
          if (!(error instanceof BadRequestError && error.message.includes('Bracket has already been created'))) {
            throw error;
          }
        }

        return NextResponse.json(updatedEvent);
      }
    }

    const updatedEvent = await updateEvent(
      resolvedParams.eventId,
      parsed.data
    );

    return NextResponse.json(updatedEvent);
  } catch (error) {
    return handleError(error);
  }
}
