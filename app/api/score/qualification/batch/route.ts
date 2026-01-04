import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  validateQualificationAccessCode,
} from '@/lib/services/qualification';
import * as qualificationRepo from '@/lib/repositories/qualification-repository';
import { handleError, BadRequestError } from '@/lib/errors';

const batchRequestSchema = z.object({
  access_code: z.string().min(1),
  event_player_ids: z.array(z.string()).min(1),
});

/**
 * POST: Get qualification data for multiple players
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = batchRequestSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestError('Invalid request body');
    }

    const { access_code, event_player_ids } = parsed.data;

    // Validate access code
    const event = await validateQualificationAccessCode(access_code);
    const supabase = await createClient();

    // Get or create qualification round
    const round = await qualificationRepo.getOrCreateQualificationRound(supabase, event.id);

    // Get all players' data
    const playersData = await Promise.all(
      event_player_ids.map(async (eventPlayerId) => {
        // Get player info
        const { data: eventPlayer, error: playerError } = await supabase
          .from('event_players')
          .select(`
            id,
            player_id,
            has_paid,
            event_id,
            player:players(
              id,
              full_name,
              nickname,
              player_number
            )
          `)
          .eq('id', eventPlayerId)
          .single();

        if (playerError || !eventPlayer) {
          return null;
        }

        if (eventPlayer.event_id !== event.id || !eventPlayer.has_paid) {
          return null;
        }

        // Get player's frames
        const frames = await qualificationRepo.getPlayerQualificationFrames(
          supabase,
          event.id,
          eventPlayerId
        );

        const framesCompleted = frames.length;
        const totalPoints = frames.reduce((sum, f) => sum + f.points_earned, 0);
        const isComplete = framesCompleted >= round.frame_count;

        const player = eventPlayer.player as unknown as {
          id: string;
          full_name: string;
          nickname: string | null;
          player_number: number | null;
        };

        return {
          event_player_id: eventPlayer.id,
          player_id: eventPlayer.player_id,
          full_name: player.full_name,
          nickname: player.nickname,
          player_number: player.player_number,
          frames_completed: framesCompleted,
          total_frames_required: round.frame_count,
          total_points: totalPoints,
          is_complete: isComplete,
          frames,
        };
      })
    );

    // Filter out null results
    const validPlayers = playersData.filter((p) => p !== null);

    return NextResponse.json({
      event,
      round: {
        id: round.id,
        frame_count: round.frame_count,
      },
      players: validPlayers,
    });
  } catch (error) {
    return handleError(error);
  }
}
