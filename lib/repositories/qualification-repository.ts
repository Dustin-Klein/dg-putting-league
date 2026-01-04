import { createClient } from '@/lib/supabase/server';
import { InternalError } from '@/lib/errors';

export interface QualificationRound {
  id: string;
  event_id: string;
  frame_count: number;
  status: 'not_started' | 'in_progress' | 'completed';
  created_by: string | null;
  created_at: string;
}

export interface QualificationFrame {
  id: string;
  qualification_round_id: string;
  event_id: string;
  event_player_id: string;
  frame_number: number;
  putts_made: number;
  points_earned: number;
  recorded_by: string | null;
  recorded_at: string;
}

export interface QualificationFrameWithPlayer extends QualificationFrame {
  event_player: {
    id: string;
    player: {
      id: string;
      full_name: string;
      nickname: string | null;
    };
  };
}

export interface PlayerQualificationStatus {
  event_player_id: string;
  player_id: string;
  player_name: string;
  frames_completed: number;
  total_frames_required: number;
  total_points: number;
  is_complete: boolean;
}

/**
 * Get or create a qualification round for an event
 */
export async function getOrCreateQualificationRound(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  frameCount: number = 5
): Promise<QualificationRound> {
  // Try to get existing round
  const { data: existingRound, error: fetchError } = await supabase
    .from('qualification_rounds')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle();

  if (fetchError) {
    throw new InternalError(`Failed to fetch qualification round: ${fetchError.message}`);
  }

  if (existingRound) {
    return existingRound as QualificationRound;
  }

  // Create new round
  const { data: newRound, error: insertError } = await supabase
    .from('qualification_rounds')
    .insert({
      event_id: eventId,
      frame_count: frameCount,
      status: 'not_started',
    })
    .select()
    .single();

  if (insertError || !newRound) {
    throw new InternalError(`Failed to create qualification round: ${insertError?.message}`);
  }

  return newRound as QualificationRound;
}

/**
 * Get full qualification round for an event (all fields)
 */
export async function getQualificationRoundFull(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<QualificationRound | null> {
  const { data, error } = await supabase
    .from('qualification_rounds')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch qualification round: ${error.message}`);
  }

  return data as QualificationRound | null;
}

/**
 * Update qualification round status
 */
export async function updateQualificationRoundStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roundId: string,
  status: 'not_started' | 'in_progress' | 'completed'
): Promise<void> {
  const { error } = await supabase
    .from('qualification_rounds')
    .update({ status })
    .eq('id', roundId);

  if (error) {
    throw new InternalError(`Failed to update qualification round status: ${error.message}`);
  }
}

/**
 * Get qualification frames for a player
 */
export async function getPlayerQualificationFrames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  eventPlayerId: string
): Promise<QualificationFrame[]> {
  const { data, error } = await supabase
    .from('qualification_frames')
    .select('*')
    .eq('event_id', eventId)
    .eq('event_player_id', eventPlayerId)
    .order('frame_number');

  if (error) {
    throw new InternalError(`Failed to fetch qualification frames: ${error.message}`);
  }

  return (data ?? []) as QualificationFrame[];
}

/**
 * Get all qualification frames for an event
 */
export async function getEventQualificationFrames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<QualificationFrameWithPlayer[]> {
  const { data, error } = await supabase
    .from('qualification_frames')
    .select(`
      *,
      event_player:event_players(
        id,
        player:players(
          id,
          full_name,
          nickname
        )
      )
    `)
    .eq('event_id', eventId)
    .order('recorded_at', { ascending: false });

  if (error) {
    throw new InternalError(`Failed to fetch qualification frames: ${error.message}`);
  }

  return (data ?? []) as unknown as QualificationFrameWithPlayer[];
}

/**
 * Record a qualification frame score
 */
export async function recordQualificationFrame(
  supabase: Awaited<ReturnType<typeof createClient>>,
  data: {
    qualificationRoundId: string;
    eventId: string;
    eventPlayerId: string;
    frameNumber: number;
    puttsMade: number;
    pointsEarned: number;
  }
): Promise<QualificationFrame> {
  const { data: frame, error } = await supabase
    .from('qualification_frames')
    .upsert(
      {
        qualification_round_id: data.qualificationRoundId,
        event_id: data.eventId,
        event_player_id: data.eventPlayerId,
        frame_number: data.frameNumber,
        putts_made: data.puttsMade,
        points_earned: data.pointsEarned,
        recorded_at: new Date().toISOString(),
      },
      { onConflict: 'event_player_id,frame_number' }
    )
    .select()
    .single();

  if (error || !frame) {
    throw new InternalError(`Failed to record qualification frame: ${error?.message}`);
  }

  return frame as QualificationFrame;
}

/**
 * Get qualification status for all players in an event
 */
export async function getEventPlayersQualificationStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<PlayerQualificationStatus[]> {
  // Get qualification round
  const round = await getQualificationRoundFull(supabase, eventId);
  const frameCount = round?.frame_count ?? 5;

  // Get all paid event players
  const { data: eventPlayers, error: playersError } = await supabase
    .from('event_players')
    .select(`
      id,
      player_id,
      has_paid,
      player:players(
        id,
        full_name
      )
    `)
    .eq('event_id', eventId)
    .eq('has_paid', true);

  if (playersError) {
    throw new InternalError(`Failed to fetch event players: ${playersError.message}`);
  }

  // Get all qualification frames for the event
  const { data: frames, error: framesError } = await supabase
    .from('qualification_frames')
    .select('event_player_id, points_earned')
    .eq('event_id', eventId);

  if (framesError) {
    throw new InternalError(`Failed to fetch qualification frames: ${framesError.message}`);
  }

  // Aggregate frames by player
  const framesByPlayer: Record<string, { count: number; totalPoints: number }> = {};
  for (const frame of frames ?? []) {
    if (!framesByPlayer[frame.event_player_id]) {
      framesByPlayer[frame.event_player_id] = { count: 0, totalPoints: 0 };
    }
    framesByPlayer[frame.event_player_id].count++;
    framesByPlayer[frame.event_player_id].totalPoints += frame.points_earned;
  }

  // Build status for each player
  return (eventPlayers ?? []).map((ep) => {
    const playerData = framesByPlayer[ep.id] ?? { count: 0, totalPoints: 0 };
    const player = ep.player as unknown as { full_name: string };
    return {
      event_player_id: ep.id,
      player_id: ep.player_id,
      player_name: player.full_name,
      frames_completed: playerData.count,
      total_frames_required: frameCount,
      total_points: playerData.totalPoints,
      is_complete: playerData.count >= frameCount,
    };
  });
}

/**
 * Get paid event players eligible for qualification
 */
export async function getPaidEventPlayers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string
): Promise<Array<{
  id: string;
  player_id: string;
  player: {
    id: string;
    full_name: string;
    nickname: string | null;
    player_number: number | null;
  };
}>> {
  const { data, error } = await supabase
    .from('event_players')
    .select(`
      id,
      player_id,
      player:players(
        id,
        full_name,
        nickname,
        player_number
      )
    `)
    .eq('event_id', eventId)
    .eq('has_paid', true);

  if (error) {
    throw new InternalError(`Failed to fetch paid event players: ${error.message}`);
  }

  return (data ?? []) as unknown as Array<{
    id: string;
    player_id: string;
    player: {
      id: string;
      full_name: string;
      nickname: string | null;
      player_number: number | null;
    };
  }>;
}

/**
 * Get a specific qualification frame
 */
export async function getQualificationFrame(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventPlayerId: string,
  frameNumber: number
): Promise<QualificationFrame | null> {
  const { data, error } = await supabase
    .from('qualification_frames')
    .select('*')
    .eq('event_player_id', eventPlayerId)
    .eq('frame_number', frameNumber)
    .maybeSingle();

  if (error) {
    throw new InternalError(`Failed to fetch qualification frame: ${error.message}`);
  }

  return data as QualificationFrame | null;
}

/**
 * Delete a qualification frame
 */
export async function deleteQualificationFrame(
  supabase: Awaited<ReturnType<typeof createClient>>,
  frameId: string
): Promise<void> {
  const { error } = await supabase
    .from('qualification_frames')
    .delete()
    .eq('id', frameId);

  if (error) {
    throw new InternalError(`Failed to delete qualification frame: ${error.message}`);
  }
}

/**
 * Get next frame number for a player
 */
export async function getNextFrameNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventPlayerId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('qualification_frames')
    .select('frame_number')
    .eq('event_player_id', eventPlayerId)
    .order('frame_number', { ascending: false })
    .limit(1);

  if (error) {
    throw new InternalError(`Failed to get next frame number: ${error.message}`);
  }

  const lastFrame = data?.[0]?.frame_number ?? 0;
  return lastFrame + 1;
}
