import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

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
});

export async function POST(
  request: Request,
  { params: paramsPromise }: { params: Promise<{ leagueId: string }> | { leagueId: string } }
) {
  // Ensure params is resolved if it's a Promise
  const params = await Promise.resolve(paramsPromise);
  const leagueId = params.leagueId;
  try {
    const supabase = await createClient();

    // Check if user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is an admin of this league
    const { data: leagueAdmin, error: adminError } = await supabase
      .from('league_admins')
      .select('*')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .single();

    if (adminError || !leagueAdmin) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Validate request body
    const body = await request.json();
    const validation = eventSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { data: existingEvent, error: existingEventError } = await supabase
      .from('events')
      .select('id')
      .eq('access_code', body.access_code)
      .maybeSingle();

    if (existingEventError) {
      console.error('Error checking for existing event:', existingEventError);
      return NextResponse.json(
        { error: 'Error checking for existing event' },
        { status: 500 }
      );
    }

    if (existingEvent) {
      return NextResponse.json(
        { error: 'An event with this access code already exists' },
        { status: 409 }
      );
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
        status: 'registration',
      })
      .select()
      .single();

    if (eventError) {
      console.error('Error creating event:', eventError);
      return NextResponse.json(
        { error: 'Failed to create event' },
        { status: 500 }
      );
    }

    return NextResponse.json(event);
  } catch (error) {
    console.error('Error in events API route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
