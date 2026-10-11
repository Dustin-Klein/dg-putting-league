import 'server-only';
import { and, count, eq, gte, inArray, sum } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { event_players, frame_results, players, qualification_frames } from '@/lib/db/schema';
import { toIsoTimestamp, toNumber } from '@/lib/db/mappers';
import { InternalError, NotFoundError } from '@/lib/errors';
import type { EventPlayer, PaymentType } from '@/lib/types/player';

export interface EventPlayerData {
  id: string;
  event_id: string;
  player_id: string;
  created_at: string;
  payment_type: PaymentType | null;
  pool: 'A' | 'B' | null;
  pfa_score: number | null;
  scoring_method: 'qualification' | 'pfa' | 'default' | null;
}

function mapEventPlayerData(row: typeof event_players.$inferSelect): EventPlayerData {
  return {
    id: row.id,
    event_id: row.event_id,
    player_id: row.player_id,
    payment_type: row.payment_type as PaymentType | null,
    created_at: toIsoTimestamp(row.created_at),
    pool: row.pool,
    pfa_score: toNumber(row.pfa_score),
    scoring_method: row.scoring_method as EventPlayerData['scoring_method'],
  };
}

function mapJoinedEventPlayer(row: {
  eventPlayer: typeof event_players.$inferSelect;
  player: Pick<typeof players.$inferSelect, 'id' | 'full_name' | 'nickname' | 'created_at' | 'default_pool' | 'player_number'>;
}): EventPlayer {
  return {
    ...mapEventPlayerData(row.eventPlayer),
    player: { ...row.player, created_at: toIsoTimestamp(row.player.created_at) },
  };
}

const joinedPlayerColumns = {
  id: players.id,
  full_name: players.full_name,
  nickname: players.nickname,
  created_at: players.created_at,
  default_pool: players.default_pool,
  player_number: players.player_number,
};

export async function getEventPlayerByPlayerAndEvent(
  ex: Executor,
  eventId: string,
  playerId: string
): Promise<EventPlayerData | null> {
  const [row] = await ex.select().from(event_players)
    .where(and(eq(event_players.event_id, eventId), eq(event_players.player_id, playerId)))
    .limit(1);
  return row ? mapEventPlayerData(row) : null;
}

export async function insertEventPlayer(ex: Executor, eventId: string, playerId: string): Promise<string> {
  const [row] = await ex.insert(event_players).values({ event_id: eventId, player_id: playerId })
    .returning({ id: event_players.id });
  if (!row) throw new InternalError('Failed to add player to event');
  return row.id;
}

export async function getEventPlayer(ex: Executor, eventId: string, eventPlayerId: string): Promise<EventPlayer> {
  const [row] = await ex.select({ eventPlayer: event_players, player: joinedPlayerColumns })
    .from(event_players)
    .innerJoin(players, eq(players.id, event_players.player_id))
    .where(and(eq(event_players.id, eventPlayerId), eq(event_players.event_id, eventId)))
    .limit(1);
  if (!row) throw new InternalError('Failed to fetch event player');
  return mapJoinedEventPlayer(row);
}

export async function getEventPlayersBulk(
  ex: Executor,
  eventId: string,
  eventPlayerIds: string[]
): Promise<EventPlayer[]> {
  if (eventPlayerIds.length === 0) return [];
  const rows = await ex.select({ eventPlayer: event_players, player: joinedPlayerColumns })
    .from(event_players)
    .innerJoin(players, eq(players.id, event_players.player_id))
    .where(and(eq(event_players.event_id, eventId), inArray(event_players.id, eventPlayerIds)));
  return rows.map(mapJoinedEventPlayer);
}

export async function deleteEventPlayer(ex: Executor, eventId: string, eventPlayerId: string): Promise<void> {
  await ex.delete(event_players)
    .where(and(eq(event_players.id, eventPlayerId), eq(event_players.event_id, eventId)));
}

export async function updateEventPlayerPayment(
  ex: Executor,
  eventId: string,
  playerId: string,
  paymentType: PaymentType | null
): Promise<{ id: string; payment_type: PaymentType | null } | null> {
  const [row] = await ex.update(event_players).set({ payment_type: paymentType })
    .where(and(eq(event_players.event_id, eventId), eq(event_players.player_id, playerId)))
    .returning({ id: event_players.id, payment_type: event_players.payment_type });
  return row ? { id: row.id, payment_type: row.payment_type as PaymentType | null } : null;
}

export async function getQualificationScore(ex: Executor, eventId: string, eventPlayerId: string): Promise<number> {
  const [row] = await ex.select({ total: sum(qualification_frames.points_earned) })
    .from(qualification_frames)
    .where(and(eq(qualification_frames.event_id, eventId), eq(qualification_frames.event_player_id, eventPlayerId)));
  return toNumber(row?.total ?? 0);
}

/** Aggregate all recent frame history for each player, including hand-entered rows. */
export async function getPfaScoresBulk(
  ex: Executor,
  playerIds: string[],
  sinceDate: Date
): Promise<Map<string, { totalPoints: number; frameCount: number }>> {
  if (playerIds.length === 0) return new Map();
  const rows = await ex.select({
    player_id: event_players.player_id,
    total_points: sum(frame_results.points_earned),
    frame_count: count(frame_results.id),
  }).from(frame_results)
    .innerJoin(event_players, eq(event_players.id, frame_results.event_player_id))
    .where(and(inArray(event_players.player_id, playerIds), gte(frame_results.recorded_at, sinceDate.toISOString())))
    .groupBy(event_players.player_id);

  return new Map(rows.map((row) => [row.player_id, {
    totalPoints: toNumber(row.total_points ?? 0),
    frameCount: toNumber(row.frame_count),
  }]));
}

export async function getEventPlayerIds(ex: Executor, eventId: string): Promise<string[]> {
  const rows = await ex.select({ id: event_players.id }).from(event_players)
    .where(eq(event_players.event_id, eventId));
  return rows.map((r) => r.id);
}

export interface PlayerScoreRow {
  event_player_id: string;
  /** Null for every format but the random doubles draw. */
  pool: 'A' | 'B' | null;
  pfa_score: number;
  scoring_method: string;
}

export async function applyPlayerScores(
  ex: Executor,
  eventId: string,
  assignments: PlayerScoreRow[]
): Promise<void> {
  for (const a of assignments) {
    const updated = await ex.update(event_players)
      .set({ pool: a.pool, pfa_score: String(a.pfa_score), scoring_method: a.scoring_method })
      .where(and(eq(event_players.id, a.event_player_id), eq(event_players.event_id, eventId)))
      .returning({ id: event_players.id });
    if (updated.length === 0) throw new NotFoundError(`Event player not found: ${a.event_player_id}`);
  }
}
