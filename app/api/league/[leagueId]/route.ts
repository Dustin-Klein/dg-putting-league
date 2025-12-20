import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  handleError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  InternalError,
  NotFoundError
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
});

export async function POST(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ leagueId: string }> | { leagueId: string } }
) {
  try {
    // Ensure params is resolved if it's a Promise
    const params = await Promise.resolve(paramsPromise);
    const leagueId = params.leagueId;
    
    const supabase = await createClient();

    // Check if user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Check if user is an admin of this league
    const { data: leagueAdmin, error: adminError } = await supabase
      .from('league_admins')
      .select('*')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .single();

    if (adminError || !leagueAdmin) {
      throw new ForbiddenError('Insufficient permissions');
    }

    // Validate request body
    const body = await request.json();
    const validation = eventSchema.safeParse(body);

    if (!validation.success) {
      throw new BadRequestError('Invalid request body');
    }

    const { data: existingEvent, error: existingEventError } = await supabase
      .from('events')
      .select('id')
      .eq('access_code', body.access_code)
      .maybeSingle();

    if (existingEventError) {
      console.error('Error checking for existing event:', existingEventError);
      throw new InternalError('Error checking for existing event');
    }

    if (existingEvent) {
      throw new BadRequestError('An event with this access code already exists');
    }

    // Parse and format the date to ensure it's stored correctly
    const eventDate = new Date(body.event_date);
    const formattedDate = eventDate.toISOString().split('T')[0];
    
    const { data: event, error: eventError } = await supabase
      .from('events')
      .insert({
        league_id: params.leagueId,
        event_date: formattedDate,
        location: body.location,
        lane_count: body.lane_count,
        putt_distance_ft: body.putt_distance_ft,
        access_code: body.access_code,
        qualification_round_enabled: body.qualification_round_enabled ?? false,
        status: 'registration',
      })
      .select()
      .single();

    if (eventError) {
      console.error('Error creating event:', eventError);
      throw new InternalError('Failed to create event');
    }

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
