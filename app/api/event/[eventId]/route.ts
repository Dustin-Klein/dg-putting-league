import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getEventWithPlayers,
  deleteEvent,
  updateEvent,
} from '@/lib/event';
import {
  handleError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
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
      const newStatus = parsed.data.status;
      const currentStatus = currentEvent.status;
      
      // Validate status flow
      const statusFlow: Record<string, string[]> = {
        'created': ['pre-bracket'],
        'pre-bracket': ['bracket'],
        'bracket': ['completed'],
        'completed': []
      };
      
      if (!statusFlow[currentStatus]?.includes(newStatus)) {
        throw new BadRequestError(`Invalid status transition from ${currentStatus} to ${newStatus}`);
      }
      
      // Validation for pre-bracket to bracket transition
      if (currentStatus === 'pre-bracket' && newStatus === 'bracket') {
        if (currentEvent.qualification_round_enabled) {
          // Check if all players have completed qualifying rounds
          // We need to check if each player has the required number of frames completed
          const supabase = await createClient();
          
          // Get the qualification round for this event
          const { data: qualificationRound } = await supabase
            .from('qualification_rounds')
            .select('frame_count')
            .eq('event_id', resolvedParams.eventId)
            .single();
            
          if (!qualificationRound) {
            throw new BadRequestError(
              'No qualification round found for this event'
            );
          }
          
          // Get frame counts for each player
          const { data: playerFrames } = await supabase
            .from('qualification_frames')
            .select('event_player_id')
            .eq('event_id', resolvedParams.eventId);
            
          // Count frames per player
          const frameCounts: Record<string, number> = {};
          playerFrames?.forEach(frame => {
            frameCounts[frame.event_player_id] = (frameCounts[frame.event_player_id] || 0) + 1;
          });
          
          // Check if all players have completed the required number of frames
          const incompletePlayers = currentEvent.players.filter(
            (player) => (frameCounts[player.id] || 0) < qualificationRound.frame_count
          );
          
          if (incompletePlayers.length > 0) {
            throw new BadRequestError(
              `All players must complete ${qualificationRound.frame_count} qualifying frames before starting bracket play`
            );
          }
        } else {
          // Check if all players have paid
          const unpaidPlayers = currentEvent.players.filter(
            (player) => !player.has_paid
          );
          if (unpaidPlayers.length > 0) {
            throw new BadRequestError(
              'All players must be marked as paid before starting bracket play'
            );
          }
        }
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
