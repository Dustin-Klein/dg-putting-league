import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from '@/lib/errors';
import { calculatePoints } from '@/lib/services/scoring/points-calculator';
import * as qualificationRepo from '@/lib/repositories/qualification-repository';
import * as eventRepo from '@/lib/repositories/event-repository';
import * as eventPlayerRepo from '@/lib/repositories/event-player-repository';
import type {
  QualificationRound,
  QualificationFrame,
  PlayerQualificationStatus,
} from '@/lib/repositories/qualification-repository';

// Re-export types
export type {
  QualificationRound,
  QualificationFrame,
  PlayerQualificationStatus,
};

export interface PublicQualificationEventInfo {
  id: string;
  event_date: string;
  location: string | null;
  lane_count: number;
  bonus_point_enabled: boolean;
  qualification_round_enabled: boolean;
  status: string;
}

export interface PublicQualificationPlayerInfo {
  event_player_id: string;
  player_id: string;
  full_name: string;
  nickname: string | null;
  player_number: number | null;
  frames_completed: number;
  total_frames_required: number;
  total_points: number;
  is_complete: boolean;
}

/**
 * Validate access code for qualification scoring
 * Returns event info if valid, throws if not
 */
export async function validateQualificationAccessCode(
  accessCode: string
): Promise<PublicQualificationEventInfo> {
  const supabase = await createClient();

  const event = await eventRepo.getEventByAccessCodeForQualification(supabase, accessCode);

  if (!event) {
    throw new NotFoundError('Invalid access code or event is not accepting qualification scores');
  }

  return event as PublicQualificationEventInfo;
}

/**
 * Get paid players for qualification with their completion status
 */
export async function getPlayersForQualification(
  accessCode: string
): Promise<PublicQualificationPlayerInfo[]> {
  const event = await validateQualificationAccessCode(accessCode);
  const supabase = await createClient();

  // Get or create qualification round
  const round = await qualificationRepo.getOrCreateQualificationRound(supabase, event.id);

  // Get all paid event players
  const paidPlayers = await qualificationRepo.getPaidEventPlayers(supabase, event.id);

  // Get aggregated frame data for all players
  const framesByPlayer = await qualificationRepo.getQualificationFrameAggregations(supabase, event.id);

  // Build player info
  return paidPlayers.map((ep) => {
    const playerData = framesByPlayer[ep.id] ?? { count: 0, totalPoints: 0 };
    return {
      event_player_id: ep.id,
      player_id: ep.player_id,
      full_name: ep.player.full_name,
      nickname: ep.player.nickname,
      player_number: ep.player.player_number,
      frames_completed: playerData.count,
      total_frames_required: round.frame_count,
      total_points: playerData.totalPoints,
      is_complete: playerData.count >= round.frame_count,
    };
  });
}

/**
 * Get qualification scoring data for a specific player
 */
export async function getPlayerQualificationData(
  accessCode: string,
  eventPlayerId: string
): Promise<{
  event: PublicQualificationEventInfo;
  player: PublicQualificationPlayerInfo;
  frames: QualificationFrame[];
  nextFrameNumber: number;
}> {
  const event = await validateQualificationAccessCode(accessCode);
  const supabase = await createClient();

  // Get player info from repository
  const eventPlayer = await eventPlayerRepo.getEventPlayer(supabase, eventPlayerId);

  if (eventPlayer.event_id !== event.id) {
    throw new ForbiddenError('Player does not belong to this event');
  }

  if (!eventPlayer.has_paid) {
    throw new BadRequestError('Player must be marked as paid to participate in qualification');
  }

  // Get qualification round
  const round = await qualificationRepo.getOrCreateQualificationRound(supabase, event.id);

  // Get player's frames
  const frames = await qualificationRepo.getPlayerQualificationFrames(supabase, event.id, eventPlayerId);

  // Calculate totals
  const framesCompleted = frames.length;
  const totalPoints = frames.reduce((sum, f) => sum + f.points_earned, 0);
  const isComplete = framesCompleted >= round.frame_count;

  return {
    event,
    player: {
      event_player_id: eventPlayer.id,
      player_id: eventPlayer.player_id,
      full_name: eventPlayer.player.full_name,
      nickname: eventPlayer.player.nickname ?? null,
      player_number: eventPlayer.player.player_number ?? null,
      frames_completed: framesCompleted,
      total_frames_required: round.frame_count,
      total_points: totalPoints,
      is_complete: isComplete,
    },
    frames,
    nextFrameNumber: framesCompleted + 1,
  };
}

/**
 * Record a qualification score for a player
 */
export async function recordQualificationScore(
  accessCode: string,
  eventPlayerId: string,
  frameNumber: number,
  puttsMade: number
): Promise<{ frame: QualificationFrame; player: PublicQualificationPlayerInfo }> {
  const event = await validateQualificationAccessCode(accessCode);
  const supabase = await createClient();

  // Validate putts
  if (puttsMade < 0 || puttsMade > 3) {
    throw new BadRequestError('Putts must be between 0 and 3');
  }

  // Get player info from repository
  const eventPlayer = await eventPlayerRepo.getEventPlayer(supabase, eventPlayerId);

  if (eventPlayer.event_id !== event.id) {
    throw new ForbiddenError('Player does not belong to this event');
  }

  if (!eventPlayer.has_paid) {
    throw new BadRequestError('Player must be marked as paid to participate in qualification');
  }

  // Get qualification round
  const round = await qualificationRepo.getOrCreateQualificationRound(supabase, event.id);

  // Get existing frames to check if this would exceed the limit
  const existingFrames = await qualificationRepo.getPlayerQualificationFrames(supabase, event.id, eventPlayerId);

  // Check if trying to add more frames than allowed (unless updating existing)
  const existingFrame = existingFrames.find((f) => f.frame_number === frameNumber);
  if (!existingFrame && existingFrames.length >= round.frame_count) {
    throw new BadRequestError(`Player has already completed all ${round.frame_count} qualification frames`);
  }

  // Validate frame number
  if (frameNumber < 1 || frameNumber > round.frame_count) {
    throw new BadRequestError(`Frame number must be between 1 and ${round.frame_count}`);
  }

  // Calculate points
  const pointsEarned = calculatePoints(puttsMade, event.bonus_point_enabled);

  // Record the frame
  const frame = await qualificationRepo.recordQualificationFrame(supabase, {
    qualificationRoundId: round.id,
    eventId: event.id,
    eventPlayerId,
    frameNumber,
    puttsMade,
    pointsEarned,
  });

  // Update round status if needed
  if (round.status === 'not_started') {
    await qualificationRepo.updateQualificationRoundStatus(supabase, round.id, 'in_progress');
  }

  // Get updated player data
  const updatedFrames = await qualificationRepo.getPlayerQualificationFrames(supabase, event.id, eventPlayerId);
  const framesCompleted = updatedFrames.length;
  const totalPoints = updatedFrames.reduce((sum, f) => sum + f.points_earned, 0);

  return {
    frame,
    player: {
      event_player_id: eventPlayer.id,
      player_id: eventPlayer.player_id,
      full_name: eventPlayer.player.full_name,
      nickname: eventPlayer.player.nickname ?? null,
      player_number: eventPlayer.player.player_number ?? null,
      frames_completed: framesCompleted,
      total_frames_required: round.frame_count,
      total_points: totalPoints,
      is_complete: framesCompleted >= round.frame_count,
    },
  };
}

/**
 * Get qualification status for event (admin view)
 */
export async function getEventQualificationStatus(
  eventId: string
): Promise<{
  round: QualificationRound | null;
  players: PlayerQualificationStatus[];
  allComplete: boolean;
}> {
  const supabase = await createClient();

  const round = await qualificationRepo.getQualificationRoundFull(supabase, eventId);
  if (!round) {
    return { round: null, players: [], allComplete: false };
  }

  const players = await qualificationRepo.getEventPlayersQualificationStatus(supabase, eventId);
  const allComplete = players.length > 0 && players.every((p) => p.is_complete);

  return { round, players, allComplete };
}

/**
 * Get batch qualification data for multiple players
 */
export async function getBatchPlayerQualificationData(
  accessCode: string,
  eventPlayerIds: string[]
): Promise<{
  event: PublicQualificationEventInfo;
  round: { id: string; frame_count: number };
  players: Array<PublicQualificationPlayerInfo & { frames: QualificationFrame[] }>;
}> {
  const event = await validateQualificationAccessCode(accessCode);
  const supabase = await createClient();

  // Get or create qualification round
  const round = await qualificationRepo.getOrCreateQualificationRound(supabase, event.id);

  // Bulk fetch all event players (1 query instead of N)
  const eventPlayers = await eventPlayerRepo.getEventPlayersBulk(supabase, eventPlayerIds);

  // Filter to only valid players (belong to event and have paid)
  const validEventPlayers = eventPlayers.filter(
    (ep) => ep.event_id === event.id && ep.has_paid
  );

  if (validEventPlayers.length === 0) {
    return {
      event,
      round: {
        id: round.id,
        frame_count: round.frame_count,
      },
      players: [],
    };
  }

  const validPlayerIds = validEventPlayers.map((ep) => ep.id);

  // Bulk fetch all frames for valid players (1 query instead of N)
  const framesByPlayer = await qualificationRepo.getQualificationFramesBulk(
    supabase,
    event.id,
    validPlayerIds
  );

  // Map players with their frames and calculated data
  const players = validEventPlayers.map((eventPlayer) => {
    const frames = framesByPlayer[eventPlayer.id] ?? [];
    const framesCompleted = frames.length;
    const totalPoints = frames.reduce((sum, f) => sum + f.points_earned, 0);
    const isComplete = framesCompleted >= round.frame_count;

    return {
      event_player_id: eventPlayer.id,
      player_id: eventPlayer.player_id,
      full_name: eventPlayer.player.full_name,
      nickname: eventPlayer.player.nickname ?? null,
      player_number: eventPlayer.player.player_number ?? null,
      frames_completed: framesCompleted,
      total_frames_required: round.frame_count,
      total_points: totalPoints,
      is_complete: isComplete,
      frames,
    };
  });

  return {
    event,
    round: {
      id: round.id,
      frame_count: round.frame_count,
    },
    players,
  };
}
