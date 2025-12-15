import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const eventSchema = z.object({
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.string().nullable(),
  lane_count: z.number().int().positive(),
  putt_distance_ft: z.number().positive(),
  access_code: z.string().min(4),
});

export async function POST(
  request: Request,
  { params }: { params: { leagueId: string } }
) {
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
      .eq('league_id', params.leagueId)
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

    // Create the event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .insert({
        league_id: params.leagueId,
        event_date: body.event_date,
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

export async function GET(
  request: Request,
  { params }: { params: { leagueId: string } }
) {
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
      .eq('league_id', params.leagueId)
      .eq('user_id', user.id)
      .single();

    if (adminError || !leagueAdmin) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Fetch events for this league
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('*')
      .eq('league_id', params.leagueId)
      .order('event_date', { ascending: false });

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return NextResponse.json(
        { error: 'Failed to fetch events' },
        { status: 500 }
      );
    }

    // Get participant counts for each event
    const eventsWithParticipantCount = await Promise.all(
      (events || []).map(async (event) => {
        const { count, error: countError } = await supabase
          .from('event_players')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', event.id);

        return {
          ...event,
          participant_count: count || 0,
        };
      })
    );

    return NextResponse.json(eventsWithParticipantCount);
  } catch (error) {
    console.error('Error in events API route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
