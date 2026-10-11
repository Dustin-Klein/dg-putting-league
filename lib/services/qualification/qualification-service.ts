import 'server-only';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/errors';
import { calculatePoints } from '@/lib/services/scoring/points-calculator';
import { authorizeAccessCode, authorizeEventAdmin, type AccessCodeEvent, type Db } from '@/lib/services/auth';
import { withTransaction, type Executor } from '@/lib/db/tx';
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
  return { event: toQualificationEventInfo(event), pg };
}

/** The public projection of an access-code event for qualification scoring. */
export function toQualificationEventInfo(event: AccessCodeEvent): PublicQualificationEventInfo {
  return {
    id: event.id,
    event_date: event.event_date,
    location: event.location,
    lane_count: event.lane_count,
    bonus_point_enabled: event.bonus_point_enabled,
    qualification_round_enabled: event.qualification_round_enabled,
    qualification_frame_count: event.qualification_frame_count,
    status: event.status,
  };
}

/**
 * The event's qualification round for a read: a plain read when it exists, so reads
 * don't queue behind scorers holding the round lock. Only the first read of an event
 * creates it (under the round lock, see getOrCreateQualificationRound).
 */
async function readQualificationRound(
  pg: Db,
  event: PublicQualificationEventInfo
): Promise<QualificationRound> {
  return (
    (await qualificationRepo.getQualificationRoundFull(pg, event.id)) ??
    withTransaction(pg, (tx) =>
      qualificationRepo.getOrCreateQualificationRound(tx, event.id, event.qualification_frame_count)
    )
  );
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
  return getPlayersForQualificationDb(pg, event);
}

/**
 * `getPlayersForQualification` for a caller that already authorized the access code
 * for qualification scoring of `event`.
 */
export async function getPlayersForQualificationDb(
  pg: Db,
  event: PublicQualificationEventInfo
): Promise<PublicQualificationPlayerInfo[]> {
  const [round, paidPlayers, framesByPlayer] = await Promise.all([
    readQualificationRound(pg, event),
    qualificationRepo.getPaidEventPlayers(pg, event.id),
    qualificationRepo.getQualificationFrameAggregations(pg, event.id),
  ]);

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

  const [round, frames] = await Promise.all([
    readQualificationRound(pg, event),
    qualificationRepo.getPlayerQualificationFrames(pg, event.id, eventPlayerId),
  ]);

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
 * Inside a write transaction: lock the event and return its current scoring settings,
 * or reject if it no longer accepts qualification scores (e.g. bracket play started
 * after the access code was authorized).
 */
async function lockQualificationScoring(tx: Executor, eventId: string) {
  const current = await qualificationRepo.lockQualificationEvent(tx, eventId);
  if (!current || current.status !== 'pre-bracket' || !current.qualification_round_enabled) {
    throw new BadRequestError('Event is not accepting qualification scores');
  }
  return current;
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
  pg: Executor,
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
    const current = await lockQualificationScoring(tx, event.id);
    const eventPlayer = await eventPlayerRepo.getEventPlayer(tx, event.id, eventPlayerId);
    if (eventPlayer.event_id !== event.id) throw new ForbiddenError('Player does not belong to this event');
    if (eventPlayer.payment_type === null) {
      throw new BadRequestError('Player must be marked as paid to participate in qualification');
    }

    const round = await qualificationRepo.getOrCreateQualificationRound(tx, event.id, current.qualification_frame_count);
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
      pointsEarned: calculatePoints(puttsMade, current.bonus_point_enabled),
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

/** One player's score in a group qualification save. */
export interface QualificationFrameEntry {
  eventPlayerId: string;
  puttsMade: number;
}

/**
 * Record the same frame for a group of players in one request. All or nothing: any
 * invalid, unpaid, foreign or already-complete player rejects the whole group.
 * Re-sending the same frame overwrites it (keyed by player and frame number).
 */
export async function recordQualificationScores(
  accessCode: string,
  frameNumber: number,
  entries: QualificationFrameEntry[]
): Promise<{ results: Array<{ frame: QualificationFrame; player: PublicQualificationPlayerInfo }> }> {
  const { event, pg } = await authorizeQualificationScorer(accessCode);

  return recordQualificationScoresDb(pg, event, frameNumber, entries);
}

/** Transactional group qualification writer, exposed for direct-Postgres integration tests. */
export async function recordQualificationScoresDb(
  pg: Executor,
  event: PublicQualificationEventInfo,
  frameNumber: number,
  entries: QualificationFrameEntry[]
): Promise<{ results: Array<{ frame: QualificationFrame; player: PublicQualificationPlayerInfo }> }> {
  if (entries.length === 0) {
    throw new BadRequestError('At least one score is required');
  }
  if (new Set(entries.map((entry) => entry.eventPlayerId)).size !== entries.length) {
    throw new BadRequestError('Each player can be scored only once per frame');
  }
  if (entries.some((entry) => entry.puttsMade < 0 || entry.puttsMade > 3)) {
    throw new BadRequestError('Putts must be between 0 and 3');
  }
  const playerIds = entries.map((entry) => entry.eventPlayerId);

  const { eventPlayers, round, frames, updatedFrames } = await withTransaction(pg, async (tx) => {
    const current = await lockQualificationScoring(tx, event.id);
    const eventPlayers = await eventPlayerRepo.getEventPlayersBulk(tx, event.id, playerIds);
    const playerById = new Map(eventPlayers.map((ep) => [ep.id, ep]));
    for (const id of playerIds) {
      const eventPlayer = playerById.get(id);
      if (!eventPlayer || eventPlayer.event_id !== event.id) throw new NotFoundError('Event player not found');
      if (eventPlayer.payment_type === null) {
        throw new BadRequestError('Player must be marked as paid to participate in qualification');
      }
    }

    const round = await qualificationRepo.getOrCreateQualificationRound(tx, event.id, current.qualification_frame_count);
    if (frameNumber < 1 || frameNumber > round.frame_count) {
      throw new BadRequestError(`Frame number must be between 1 and ${round.frame_count}`);
    }
    const existingByPlayer = await qualificationRepo.getQualificationFramesBulk(tx, event.id, playerIds);
    for (const id of playerIds) {
      const existing = existingByPlayer[id] ?? [];
      if (!existing.some((frame) => frame.frame_number === frameNumber) && existing.length >= round.frame_count) {
        throw new BadRequestError(
          `${playerById.get(id)!.player.full_name} has already completed all ${round.frame_count} qualification frames`
        );
      }
    }

    const frames = await qualificationRepo.recordQualificationFrames(
      tx,
      entries.map((entry) => ({
        qualificationRoundId: round.id,
        eventId: event.id,
        eventPlayerId: entry.eventPlayerId,
        frameNumber,
        puttsMade: entry.puttsMade,
        pointsEarned: calculatePoints(entry.puttsMade, current.bonus_point_enabled),
      }))
    );
    if (round.status === 'not_started') {
      await qualificationRepo.updateQualificationRoundStatus(tx, event.id, round.id, 'in_progress');
    }
    const updatedFrames = await qualificationRepo.getQualificationFramesBulk(tx, event.id, playerIds);
    return { eventPlayers: playerById, round, frames, updatedFrames };
  });

  const frameByPlayer = new Map(frames.map((frame) => [frame.event_player_id, frame]));
  return {
    results: playerIds.map((id) => {
      const eventPlayer = eventPlayers.get(id)!;
      const playerFrames = updatedFrames[id] ?? [];
      const framesCompleted = playerFrames.length;
      return {
        frame: frameByPlayer.get(id)!,
        player: {
          event_player_id: eventPlayer.id,
          player_id: eventPlayer.player_id,
          full_name: eventPlayer.player.full_name,
          nickname: eventPlayer.player.nickname ?? null,
          player_number: eventPlayer.player.player_number ?? null,
          frames_completed: framesCompleted,
          total_frames_required: round.frame_count,
          total_points: playerFrames.reduce((sum, f) => sum + f.points_earned, 0),
          is_complete: framesCompleted >= round.frame_count,
        },
      };
    }),
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

  const [round, eventPlayers] = await Promise.all([
    readQualificationRound(pg, event),
    eventPlayerRepo.getEventPlayersBulk(pg, event.id, eventPlayerIds),
  ]);

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
