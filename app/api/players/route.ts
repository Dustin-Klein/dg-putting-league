import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const requestData = await request.json();
    const fullName = requestData.name?.toString();
    const email = requestData.email?.toString();
    const nickname = requestData.nickname?.toString();
    const defaultPool = requestData.default_pool as 'A' | 'B' | undefined;

    if (!fullName) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    // Check if player with this email already exists
    if (email) {
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('id')
        .eq('email', email)
        .single();

      if (existingPlayer) {
        return NextResponse.json(
          { 
            error: 'A player with this email already exists',
            playerId: existingPlayer.id
          },
          { status: 400 }
        );
      }
    }

    // Create new player
    const playerData: any = {
      full_name: fullName,
      email: email,
      created_at: new Date().toISOString()
    };

    // Add optional fields if they exist
    if (nickname) playerData.nickname = nickname;
    if (defaultPool) playerData.default_pool = defaultPool;

    const { data: newPlayer, error } = await supabase
      .from('players')
      .insert([playerData])
      .select('id')
      .single();

    if (error) {
      console.error('Error creating player:', error);
      throw error;
    }

    return NextResponse.json({ 
      success: true, 
      playerId: newPlayer.id 
    });

  } catch (error) {
    console.error('Error in create player API:', error);
    return NextResponse.json(
      { error: 'Failed to create player' },
      { status: 500 }
    );
  }
}
