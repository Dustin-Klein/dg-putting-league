import 'server-only';
import {
  BadRequestError,
  ForbiddenError,
} from '@/lib/errors';
import { calculatePoints } from '@/lib/services/scoring/points-calculator';
import { authorizeAccessCode, authorizeEventAdmin, type Db } from '@/lib/services/auth';
import { withTransaction } from '@/lib/db/tx';
import * as qualificationRepo from '@/lib/repositories/qualification-repository.db';
import * as eventPlayerRepo from '@/lib/repositories/event-player-repository.db';
import type {
  QualificationRound,
  QualificationFrame,
  PlayerQualificationStatus,
} from '@/lib/repositories/qualification-repository.db';

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
  qualification_frame_count: number;
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
 * Authorize a qualification scorer by access code.
 * Returns the event and the authorized database connection for this request.
 */
async function authorizeQualificationScorer(
  accessCode: string
): Promise<{ event: PublicQualificationEventInfo; pg: Db }> {
  const { event, pg } = await authorizeAccessCode(accessCode, { mode: 'qualification' });
  return {
    event: {
      id: event.id,
      event_date: event.event_date,
      location: event.location,
      lane_count: event.lane_count,
      bonus_point_enabled: event.bonus_point_enabled,
      qualification_round_enabled: event.qualification_round_enabled,
      qualification_frame_count: event.qualification_frame_count,
      status: event.status,
    },
    pg,
  };
}

/**
 * Validate access code for qualification scoring
 * Returns event info if valid, throws if not
 */
export async function validateQualificationAccessCode(
  accessCode: string
): Promise<PublicQualificationEventInfo> {
  const { event } = await authorizeQualificationScorer(accessCode);
  return event;
}

/**
 * Get paid players for qualification with their completion status
 */
export async function getPlayersForQualification(
  accessCode: string
): Promise<PublicQualificationPlayerInfo[]> {
  const { event, pg } = await authorizeQualificationScorer(accessCode);

  // Get or create qualification round
  const { round, paidPlayers, framesByPlayer } = await withTransaction(pg, async (tx) => ({
    round: await qualificationRepo.getOrCreateQualificationRound(tx, event.id, event.qualification_frame_count),
    paidPlayers: await qualificationRepo.getPaidEventPlayers(tx, event.id),
    framesByPlayer: await qualificationRepo.getQualificationFrameAggregations(tx, event.id),
  }));

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
  const { event, pg } = await authorizeQualificationScorer(accessCode);

  // Get player info from repository
  const eventPlayer = await eventPlayerRepo.getEventPlayer(pg, event.id, eventPlayerId);

  if (eventPlayer.event_id !== event.id) {
    throw new ForbiddenError('Player does not belong to this event');
  }

  if (eventPlayer.payment_type === null) {
    throw new BadRequestError('Player must be marked as paid to participate in qualification');
  }

  // Get qualification round
  const { round, frames } = await withTransaction(pg, async (tx) => ({
    round: await qualificationRepo.getOrCreateQualificationRound(tx, event.id, event.qualification_frame_count),
    frames: await qualificationRepo.getPlayerQualificationFrames(tx, event.id, eventPlayerId),
  }));

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
  const { event, pg } = await authorizeQualificationScorer(accessCode);

  return recordQualificationScoreDb(pg, event, eventPlayerId, frameNumber, puttsMade);
}

/** Transactional qualification writer, exposed for direct-Postgres integration tests. */
export async function recordQualificationScoreDb(
  pg: Db,
  event: PublicQualificationEventInfo,
  eventPlayerId: string,
  frameNumber: number,
  puttsMade: number
): Promise<{ frame: QualificationFrame; player: PublicQualificationPlayerInfo }> {

  // Validate putts
  if (puttsMade < 0 || puttsMade > 3) {
    throw new BadRequestError('Putts must be between 0 and 3');
  }

  const { eventPlayer, round, frame, updatedFrames } = await withTransaction(pg, async (tx) => {
    const eventPlayer = await eventPlayerRepo.getEventPlayer(tx, event.id, eventPlayerId);
    if (eventPlayer.event_id !== event.id) throw new ForbiddenError('Player does not belong to this event');
    if (eventPlayer.payment_type === null) {
      throw new BadRequestError('Player must be marked as paid to participate in qualification');
    }

    const round = await qualificationRepo.getOrCreateQualificationRound(tx, event.id, event.qualification_frame_count);
    const existingFrames = await qualificationRepo.getPlayerQualificationFrames(tx, event.id, eventPlayerId);
    const existingFrame = existingFrames.find((candidate) => candidate.frame_number === frameNumber);
    if (!existingFrame && existingFrames.length >= round.frame_count) {
      throw new BadRequestError(`Player has already completed all ${round.frame_count} qualification frames`);
    }
    if (frameNumber < 1 || frameNumber > round.frame_count) {
      throw new BadRequestError(`Frame number must be between 1 and ${round.frame_count}`);
    }

    const frame = await qualificationRepo.recordQualificationFrame(tx, {
      qualificationRoundId: round.id,
      eventId: event.id,
      eventPlayerId,
      frameNumber,
      puttsMade,
      pointsEarned: calculatePoints(puttsMade, event.bonus_point_enabled),
    });
    if (round.status === 'not_started') {
      await qualificationRepo.updateQualificationRoundStatus(tx, event.id, round.id, 'in_progress');
    }
    const updatedFrames = await qualificationRepo.getPlayerQualificationFrames(tx, event.id, eventPlayerId);
    return { eventPlayer, round, frame, updatedFrames };
  });
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
  // Reads payment status, which only the server can see
  const { pg } = await authorizeEventAdmin(eventId);

  const round = await qualificationRepo.getQualificationRoundFull(pg, eventId);
  if (!round) {
    return { round: null, players: [], allComplete: false };
  }

  const players = await qualificationRepo.getEventPlayersQualificationStatus(pg, eventId);
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
  const { event, pg } = await authorizeQualificationScorer(accessCode);

  // Get qualification round
  const { round, eventPlayers } = await withTransaction(pg, async (tx) => ({
    round: await qualificationRepo.getOrCreateQualificationRound(tx, event.id, event.qualification_frame_count),
    eventPlayers: await eventPlayerRepo.getEventPlayersBulk(tx, event.id, eventPlayerIds),
  }));

  // Filter to only valid players (belong to event and have paid)
  const validEventPlayers = eventPlayers.filter(
    (ep) => ep.event_id === event.id && ep.payment_type !== null
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
    pg,
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
