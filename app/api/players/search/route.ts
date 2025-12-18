import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');

    if (!query) {
      return NextResponse.json(
        { results: [] },
        { status: 200 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data: players, error } = await supabase
      .from('players')
      .select('id, full_name')
      .or(`full_name.ilike.%${query}%`)
      .limit(10);

    if (error) {
      console.error('Error searching players:', error);
      return NextResponse.json(
        { error: 'Failed to search players' },
        { status: 500 }
      );
    }

    return NextResponse.json({ results: players || [] });
  } catch (error) {
    console.error('Error in search API route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
