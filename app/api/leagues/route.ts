import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    
    const { name, city } = body ?? {};
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'League name is required' }, { status: 400 });
    }

    const { data: league, error } = await supabase.rpc('create_league_with_admin', {
      p_name: name,
      p_city: city || null,
      p_user_id: user.id,
    });
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Ensure consistent response shape
    const parsed = typeof league === 'string' ? JSON.parse(league) : league;
    return NextResponse.json({ id: parsed.id, ...parsed }, { status: 201 });
  } catch (error) {
    console.error('Error creating league:', error);
    return NextResponse.json({ error: 'Failed to create league' }, { status: 500 });
  }
}
