import 'server-only';
import { and, asc, count, eq, inArray, isNotNull, sql, sum } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { events, event_players, players, qualification_frames, qualification_rounds } from '@/lib/db/schema';
import { toIsoTimestamp, toNumber } from '@/lib/db/mappers';
import { InternalError, NotFoundError } from '@/lib/errors';

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

export interface PlayerQualificationStatus {
  event_player_id: string;
  player_id: string;
  player_name: string;
  frames_completed: number;
  total_frames_required: number;
  total_points: number;
  is_complete: boolean;
}

function mapRound(row: typeof qualification_rounds.$inferSelect): QualificationRound {
  return { ...row, created_at: toIsoTimestamp(row.created_at) };
}

function mapFrame(row: typeof qualification_frames.$inferSelect): QualificationFrame {
  return { ...row, recorded_at: toIsoTimestamp(row.recorded_at) };
}

/**
 * Get the event's qualification round, creating it if needed, and lock it
 * (`FOR UPDATE`) so callers can check a player's frame count without racing other
 * scorers. The event row is held `FOR SHARE` so the event can't leave qualification
 * mid-write. qualification_rounds has no unique(event_id), so first-round creation
 * is serialized with a transaction-scoped advisory lock instead of ON CONFLICT.
 */
export async function getOrCreateQualificationRound(
  ex: Executor,
  eventId: string,
  frameCount: number,
  createdBy: string | null = null
): Promise<QualificationRound> {
  const [event] = await ex.select({ id: events.id }).from(events)
    .where(eq(events.id, eventId)).for('share');
  if (!event) throw new NotFoundError('Event not found');

  const lockRound = async () => {
    const [row] = await ex.select().from(qualification_rounds)
      .where(eq(qualification_rounds.event_id, eventId)).for('update');
    return row;
  };

  const existing = await lockRound();
  if (existing) return mapRound(existing);

  await ex.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'qualification-round:' + eventId}, 0))`
  );
  const raced = await lockRound();
  if (raced) return mapRound(raced);

  await ex.insert(qualification_rounds).values({
    event_id: eventId,
    frame_count: frameCount,
    status: 'not_started',
    created_by: createdBy,
  });

  const created = await lockRound();
  if (!created) throw new InternalError('Failed to create qualification round');
  return mapRound(created);
}

export async function getQualificationRoundFull(ex: Executor, eventId: string): Promise<QualificationRound | null> {
  const [row] = await ex.select().from(qualification_rounds)
    .where(eq(qualification_rounds.event_id, eventId)).limit(1);
  return row ? mapRound(row) : null;
}

export async function updateQualificationRoundStatus(
  ex: Executor,
  eventId: string,
  roundId: string,
  status: QualificationRound['status']
): Promise<void> {
  const updated = await ex.update(qualification_rounds).set({ status })
    .where(and(eq(qualification_rounds.id, roundId), eq(qualification_rounds.event_id, eventId)))
    .returning({ id: qualification_rounds.id });
  if (updated.length === 0) throw new NotFoundError('Qualification round not found');
}

export async function getPlayerQualificationFrames(
  ex: Executor,
  eventId: string,
  eventPlayerId: string
): Promise<QualificationFrame[]> {
  const rows = await ex.select().from(qualification_frames)
    .where(and(eq(qualification_frames.event_id, eventId), eq(qualification_frames.event_player_id, eventPlayerId)))
    .orderBy(asc(qualification_frames.frame_number));
  return rows.map(mapFrame);
}

export async function getQualificationFramesBulk(
  ex: Executor,
  eventId: string,
  eventPlayerIds: string[]
): Promise<Record<string, QualificationFrame[]>> {
  if (eventPlayerIds.length === 0) return {};
  const rows = await ex.select().from(qualification_frames)
    .where(and(eq(qualification_frames.event_id, eventId), inArray(qualification_frames.event_player_id, eventPlayerIds)))
    .orderBy(asc(qualification_frames.frame_number));
  const grouped: Record<string, QualificationFrame[]> = {};
  for (const row of rows) (grouped[row.event_player_id] ??= []).push(mapFrame(row));
  return grouped;
}

export async function getQualificationFrameAggregations(
  ex: Executor,
  eventId: string
): Promise<Record<string, { count: number; totalPoints: number }>> {
  const rows = await ex.select({
    event_player_id: qualification_frames.event_player_id,
    frame_count: count(qualification_frames.id),
    total_points: sum(qualification_frames.points_earned),
  }).from(qualification_frames)
    .where(eq(qualification_frames.event_id, eventId))
    .groupBy(qualification_frames.event_player_id);
  return Object.fromEntries(rows.map((row) => [row.event_player_id, {
    count: toNumber(row.frame_count),
    totalPoints: toNumber(row.total_points ?? 0),
  }]));
}

export async function recordQualificationFrame(
  ex: Executor,
  data: {
    qualificationRoundId: string;
    eventId: string;
    eventPlayerId: string;
    frameNumber: number;
    puttsMade: number;
    pointsEarned: number;
    recordedBy?: string | null;
  }
): Promise<QualificationFrame> {
  const [ownedPlayer] = await ex.select({ id: event_players.id }).from(event_players)
    .where(and(eq(event_players.id, data.eventPlayerId), eq(event_players.event_id, data.eventId)))
    .limit(1);
  if (!ownedPlayer) throw new NotFoundError('Event player not found');

  const [frame] = await ex.insert(qualification_frames).values({
    qualification_round_id: data.qualificationRoundId,
    event_id: data.eventId,
    event_player_id: data.eventPlayerId,
    frame_number: data.frameNumber,
    putts_made: data.puttsMade,
    points_earned: data.pointsEarned,
    recorded_by: data.recordedBy ?? null,
    recorded_at: sql`now()`,
  }).onConflictDoUpdate({
    target: [qualification_frames.event_player_id, qualification_frames.frame_number],
    set: {
      qualification_round_id: data.qualificationRoundId,
      event_id: data.eventId,
      putts_made: data.puttsMade,
      points_earned: data.pointsEarned,
      recorded_by: data.recordedBy ?? null,
      recorded_at: sql`now()`,
    },
  }).returning();
  if (!frame) throw new InternalError('Failed to record qualification frame');
  return mapFrame(frame);
}

export async function getEventPlayersQualificationStatus(
  ex: Executor,
  eventId: string
): Promise<PlayerQualificationStatus[]> {
  const round = await getQualificationRoundFull(ex, eventId);
  if (!round) throw new InternalError('Qualification round configuration not found');

  const rows = await ex.select({
    event_player_id: event_players.id,
    player_id: event_players.player_id,
    player_name: players.full_name,
    frames_completed: count(qualification_frames.id),
    total_points: sum(qualification_frames.points_earned),
  }).from(event_players)
    .innerJoin(players, eq(players.id, event_players.player_id))
    .leftJoin(qualification_frames, and(
      eq(qualification_frames.event_player_id, event_players.id),
      eq(qualification_frames.event_id, eventId)
    ))
    .where(and(eq(event_players.event_id, eventId), isNotNull(event_players.payment_type)))
    .groupBy(event_players.id, event_players.player_id, players.full_name);

  return rows.map((row) => {
    const framesCompleted = toNumber(row.frames_completed);
    return {
      event_player_id: row.event_player_id,
      player_id: row.player_id,
      player_name: row.player_name,
      frames_completed: framesCompleted,
      total_frames_required: round.frame_count,
      total_points: toNumber(row.total_points ?? 0),
      is_complete: framesCompleted >= round.frame_count,
    };
  });
}

export async function getPaidEventPlayers(ex: Executor, eventId: string): Promise<Array<{
  id: string;
  player_id: string;
  player: { id: string; full_name: string; nickname: string | null; player_number: number | null };
}>> {
  const rows = await ex.select({
    id: event_players.id,
    player_id: event_players.player_id,
    player: { id: players.id, full_name: players.full_name, nickname: players.nickname, player_number: players.player_number },
  }).from(event_players)
    .innerJoin(players, eq(players.id, event_players.player_id))
    .where(and(eq(event_players.event_id, eventId), isNotNull(event_players.payment_type)));
  return rows;
}
