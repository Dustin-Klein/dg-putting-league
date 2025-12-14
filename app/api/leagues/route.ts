import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  try {
    const cookieStore = cookies();
    const supabase = await createClient();
    
    // Get the authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse the request body
    const { name, city } = await request.json();

    if (!name) {
      return NextResponse.json(
        { error: 'League name is required' },
        { status: 400 }
      );
    }

    // Use a database function to create both league and admin record in a single transaction
    const { data: league, error } = await supabase
      .rpc('create_league_with_admin', {
        p_name: name,
        p_city: city || null,
        p_user_id: user.id
      });

    if (error) throw error;

    return NextResponse.json(league);
  } catch (error) {
    console.error('Error creating league:', error);
    return NextResponse.json(
      { error: 'Failed to create league' },
      { status: 500 }
    );
  }
}
