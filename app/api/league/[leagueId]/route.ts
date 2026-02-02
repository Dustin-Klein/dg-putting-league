import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createEvent } from '@/lib/services/event';
import {
  handleError,
  BadRequestError,
} from '@/lib/errors';

const eventSchema = z.object({
  event_date: z.string().refine((val) => {
    return /^\d{4}-\d{2}-\d{2}$/.test(val) && !isNaN(Date.parse(val));
  }, {
    message: 'Event date must be a valid date in YYYY-MM-DD format',
  }),
  location: z.string().nullable(),
  lane_count: z.number().int().positive(),
  putt_distance_ft: z.number().positive(),
  access_code: z.string().min(4),
  qualification_round_enabled: z.boolean().optional().default(false),
  bracket_frame_count: z.number().int().min(1).max(10).default(5),
  qualification_frame_count: z.number().int().min(1).max(10).default(5),
  entry_fee_per_player: z.number().min(0).nullable().optional().default(null),
  copy_players_from_event_id: z.string().uuid().optional(),
});

export async function POST(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ leagueId: string }> | { leagueId: string } }
) {
  try {
    const params = await Promise.resolve(paramsPromise);
    const leagueId = params.leagueId;
    
    // Validate request body
    const body = await request.json();
    const validation = eventSchema.safeParse(body);

    if (!validation.success) {
      throw new BadRequestError('Invalid request body');
    }

    const event = await createEvent({
      ...validation.data,
      league_id: leagueId,
    });

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
