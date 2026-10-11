import 'server-only';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { event_players, events, league_admins, players, qualification_frames, qualification_rounds, team_members, teams } from '@/lib/db/schema';
import { toIsoTimestamp, toNumber } from '@/lib/db/mappers';
import { InternalError, NotFoundError } from '@/lib/errors';
import type { EventStatus, PayoutPlace, TeamAssignment } from '@/lib/types/event';
import type { EventPlayer, PaymentType } from '@/lib/types/player';
import type { Team, TeamMember } from '@/lib/types/team';
import type { LeagueAdminRole } from './league-repository.db';

export interface EventData {
  id: string;
  league_id: string;
  event_date: string;
  status: EventStatus;
  lane_count: number;
  location: string | null;
  putt_distance_ft: number;
  bonus_point_enabled: boolean;
  qualification_round_enabled: boolean;
  bracket_frame_count: number;
  qualification_frame_count: number;
  double_grand_final: boolean;
  entry_fee_per_player: number | null;
  admin_fees: number | null;
  admin_fee_per_player: number | null;
  payout_pool_override: number | null;
  payout_structure: PayoutPlace[] | null;
  team_size: number;
  team_assignment: TeamAssignment;
  created_at: string;
}

export interface EventWithPlayersData extends EventData {
  players: EventPlayer[];
  teams: Team[];
}

export interface AccessCodeEvent {
  id: string;
  event_date: string;
  location: string | null;
  lane_count: number;
  bonus_point_enabled: boolean;
  bracket_frame_count: number;
  qualification_round_enabled: boolean;
  qualification_frame_count: number;
  status: EventStatus;
}

const eventSelection = {
  id: events.id,
  league_id: events.league_id,
  event_date: events.event_date,
  status: events.status,
  lane_count: events.lane_count,
  location: events.location,
  putt_distance_ft: events.putt_distance_ft,
  bonus_point_enabled: events.bonus_point_enabled,
  qualification_round_enabled: events.qualification_round_enabled,
  bracket_frame_count: events.bracket_frame_count,
  qualification_frame_count: events.qualification_frame_count,
  double_grand_final: events.double_grand_final,
  entry_fee_per_player: events.entry_fee_per_player,
  admin_fees: events.admin_fees,
  admin_fee_per_player: events.admin_fee_per_player,
  payout_pool_override: events.payout_pool_override,
  payout_structure: events.payout_structure,
  team_size: events.team_size,
  team_assignment: events.team_assignment,
  created_at: events.created_at,
};

type SelectedEventRow = {
  [K in keyof typeof eventSelection]: (typeof events.$inferSelect)[K];
};

function mapEvent(row: SelectedEventRow): EventData {
  return {
    ...row,
    putt_distance_ft: toNumber(row.putt_distance_ft),
    entry_fee_per_player: toNumber(row.entry_fee_per_player),
    admin_fees: toNumber(row.admin_fees),
    admin_fee_per_player: toNumber(row.admin_fee_per_player),
    payout_pool_override: toNumber(row.payout_pool_override),
    payout_structure: row.payout_structure as PayoutPlace[] | null,
    created_at: toIsoTimestamp(row.created_at),
  };
}

export async function getEventWithPlayers(
  ex: Executor,
  eventId: string,
  opts: { includePaymentType?: boolean } = {}
): Promise<EventWithPlayersData> {
  const eventRows = await ex.select(eventSelection).from(events).where(eq(events.id, eventId)).limit(1);
  if (!eventRows[0]) throw new NotFoundError('Event not found');

  const playerSelection = {
      id: event_players.id,
      event_id: event_players.event_id,
      player_id: event_players.player_id,
      pool: event_players.pool,
      pfa_score: event_players.pfa_score,
      scoring_method: event_players.scoring_method,
      created_at: event_players.created_at,
      player_id_joined: players.id,
      full_name: players.full_name,
      nickname: players.nickname,
      player_created_at: players.created_at,
      default_pool: players.default_pool,
      player_number: players.player_number,
      ...(opts.includePaymentType ? { payment_type: event_players.payment_type } : {}),
    };
  const playerRows = await ex
    .select(playerSelection)
    .from(event_players)
    .innerJoin(players, eq(players.id, event_players.player_id))
    .where(eq(event_players.event_id, eventId));

  const eventPlayerById = new Map<string, EventPlayer>();
  for (const row of playerRows) {
    const eventPlayer = {
      id: row.id,
      event_id: row.event_id,
      player_id: row.player_id,
      ...(opts.includePaymentType
        ? { payment_type: (row.payment_type ?? null) as PaymentType | null }
        : {}),
      pool: row.pool,
      pfa_score: toNumber(row.pfa_score),
      scoring_method: row.scoring_method as EventPlayer['scoring_method'],
      created_at: toIsoTimestamp(row.created_at),
      player: {
        id: row.player_id_joined,
        full_name: row.full_name,
        nickname: row.nickname,
        created_at: toIsoTimestamp(row.player_created_at),
        default_pool: row.default_pool,
        player_number: row.player_number,
      },
    } as EventPlayer;
    eventPlayerById.set(eventPlayer.id, eventPlayer);
  }

  const teamRows = await ex
    .select({
      id: teams.id,
      event_id: teams.event_id,
      seed: teams.seed,
      pool_combo: teams.pool_combo,
      created_at: teams.created_at,
      member_team_id: team_members.team_id,
      event_player_id: team_members.event_player_id,
      role: team_members.role,
      joined_at: team_members.joined_at,
    })
    .from(teams)
    .leftJoin(team_members, eq(team_members.team_id, teams.id))
    .where(eq(teams.event_id, eventId));

  const teamsById = new Map<string, Team>();
  for (const row of teamRows) {
    let team = teamsById.get(row.id);
    if (!team) {
      team = {
        id: row.id,
        event_id: row.event_id,
        seed: row.seed,
        pool_combo: row.pool_combo,
        created_at: toIsoTimestamp(row.created_at),
        team_members: [],
      } as Team;
      teamsById.set(row.id, team);
    }
    if (row.event_player_id && row.member_team_id && row.role && row.joined_at) {
      const eventPlayer = eventPlayerById.get(row.event_player_id);
      if (!eventPlayer) throw new InternalError('Team member references an event player outside the event');
      team.team_members.push({
        team_id: row.member_team_id,
        event_player_id: row.event_player_id,
        role: row.role as TeamMember['role'],
        joined_at: toIsoTimestamp(row.joined_at),
        event_player: eventPlayer,
      });
    }
  }

  return {
    ...mapEvent(eventRows[0]),
    players: [...eventPlayerById.values()],
    teams: [...teamsById.values()],
  };
}

export async function getEventById(ex: Executor, eventId: string): Promise<EventData | null> {
  const rows = await ex.select(eventSelection).from(events).where(eq(events.id, eventId)).limit(1);
  return rows[0] ? mapEvent(rows[0]) : null;
}

export async function getEventLeagueId(ex: Executor, eventId: string): Promise<string | null> {
  const rows = await ex.select({ league_id: events.league_id }).from(events).where(eq(events.id, eventId)).limit(1);
  return rows[0]?.league_id ?? null;
}

export async function getEventsByLeagueId(
  ex: Executor,
  leagueId: string
): Promise<Array<EventData & { participant_count: number }>> {
  const [eventRows, countRows] = await Promise.all([
    ex.select(eventSelection).from(events).where(eq(events.league_id, leagueId)).orderBy(desc(events.event_date)),
    ex.select({ event_id: event_players.event_id, participant_count: count(event_players.id) })
      .from(event_players)
      .innerJoin(events, eq(events.id, event_players.event_id))
      .where(eq(events.league_id, leagueId))
      .groupBy(event_players.event_id),
  ]);
  const counts = new Map(countRows.map((row) => [row.event_id, Number(row.participant_count)]));
  return eventRows.map((row) => ({ ...mapEvent(row), participant_count: counts.get(row.id) ?? 0 }));
}

function normalizeEventPatch(data: Record<string, unknown>): typeof events.$inferInsert {
  const patch = { ...data };
  for (const key of ['putt_distance_ft', 'entry_fee_per_player', 'admin_fees', 'admin_fee_per_player', 'payout_pool_override']) {
    const value = patch[key];
    if (typeof value === 'number') patch[key] = String(value);
  }
  return patch as typeof events.$inferInsert;
}

export async function updateEvent(ex: Executor, eventId: string, data: Record<string, unknown>): Promise<EventData> {
  const rows = await ex.update(events).set(normalizeEventPatch(data)).where(eq(events.id, eventId)).returning(eventSelection);
  if (!rows[0]) throw new InternalError('Failed to update event');
  return mapEvent(rows[0]);
}

export async function updateEventStatus(ex: Executor, eventId: string, status: EventStatus): Promise<void> {
  await ex.update(events).set({ status }).where(eq(events.id, eventId));
}

export async function deleteEvent(ex: Executor, eventId: string): Promise<void> {
  const rows = await ex.delete(events).where(eq(events.id, eventId)).returning({ id: events.id });
  if (rows.length === 0) throw new NotFoundError('Event not found or you do not have permission to delete it');
}

export async function getQualificationRound(ex: Executor, eventId: string): Promise<{ frame_count: number } | null> {
  const rows = await ex.select({ frame_count: qualification_rounds.frame_count })
    .from(qualification_rounds).where(eq(qualification_rounds.event_id, eventId)).limit(1);
  return rows[0] ?? null;
}

export async function getQualificationFrameCounts(ex: Executor, eventId: string): Promise<Record<string, number>> {
  const rows = await ex.select({ event_player_id: qualification_frames.event_player_id, frame_count: count() })
    .from(qualification_frames).where(eq(qualification_frames.event_id, eventId)).groupBy(qualification_frames.event_player_id);
  return Object.fromEntries(rows.map((row) => [row.event_player_id, Number(row.frame_count)]));
}

export async function getEventScoringConfig(
  ex: Executor,
  eventId: string
): Promise<{ status: EventStatus; bonus_point_enabled: boolean } | null> {
  const rows = await ex.select({ status: events.status, bonus_point_enabled: events.bonus_point_enabled })
    .from(events).where(eq(events.id, eventId)).limit(1);
  return rows[0] ?? null;
}

export async function getEventAccessCode(ex: Executor, eventId: string): Promise<string | null> {
  const rows = await ex.select({ access_code: events.access_code }).from(events).where(eq(events.id, eventId)).limit(1);
  return rows[0]?.access_code ?? null;
}

export async function isAccessCodeUnique(ex: Executor, accessCode: string): Promise<boolean> {
  const rows = await ex.select({ id: events.id }).from(events).where(eq(events.access_code, accessCode)).limit(1);
  return rows.length === 0;
}

export interface CreateEventData {
  league_id: string;
  event_date: string;
  location: string | null;
  lane_count: number;
  putt_distance_ft: number;
  access_code: string;
  qualification_round_enabled: boolean;
  bracket_frame_count: number;
  qualification_frame_count: number;
  double_grand_final?: boolean;
  entry_fee_per_player?: number | null;
  admin_fees?: number | null;
  admin_fee_per_player?: number | null;
  status: EventStatus;
}

export async function createEvent(ex: Executor, data: CreateEventData): Promise<EventData> {
  const rows = await ex.insert(events).values({
    ...data,
    putt_distance_ft: String(data.putt_distance_ft),
    entry_fee_per_player: data.entry_fee_per_player == null ? null : String(data.entry_fee_per_player),
    admin_fees: data.admin_fees == null ? null : String(data.admin_fees),
    admin_fee_per_player: data.admin_fee_per_player == null ? null : String(data.admin_fee_per_player),
    payout_pool_override: null,
  }).returning(eventSelection);
  if (!rows[0]) throw new InternalError('Failed to create event');
  return mapEvent(rows[0]);
}

export async function copyEventPlayers(ex: Executor, sourceEventId: string, destinationEventId: string): Promise<void> {
  const rows = await ex.select({ player_id: event_players.player_id }).from(event_players)
    .where(eq(event_players.event_id, sourceEventId));
  if (rows.length > 0) {
    await ex.insert(event_players).values(rows.map(({ player_id }) => ({ event_id: destinationEventId, player_id })));
  }
}

export async function getEventBracketFrameCount(ex: Executor, eventId: string): Promise<number | null> {
  const rows = await ex.select({ bracket_frame_count: events.bracket_frame_count })
    .from(events).where(eq(events.id, eventId)).limit(1);
  return rows[0]?.bracket_frame_count ?? null;
}

export async function updateEventPayouts(
  ex: Executor,
  eventId: string,
  payoutStructure: PayoutPlace[] | null,
  payoutPoolOverride?: number | null
): Promise<void> {
  await ex.update(events).set({
    payout_structure: payoutStructure,
    ...(payoutPoolOverride !== undefined
      ? { payout_pool_override: payoutPoolOverride === null ? null : String(payoutPoolOverride) }
      : {}),
  }).where(eq(events.id, eventId));
}

/** Get the event an access code belongs to. The code must already be normalized. */
export async function getEventByAccessCode(ex: Executor, accessCode: string): Promise<AccessCodeEvent | null> {
  const rows = await ex.select({
    id: events.id,
    event_date: events.event_date,
    location: events.location,
    lane_count: events.lane_count,
    bonus_point_enabled: events.bonus_point_enabled,
    bracket_frame_count: events.bracket_frame_count,
    qualification_round_enabled: events.qualification_round_enabled,
    qualification_frame_count: events.qualification_frame_count,
    status: events.status,
  }).from(events).where(eq(events.access_code, accessCode)).limit(1);
  return rows[0] ?? null;
}

export interface EventBracketConfig {
  id: string;
  status: EventStatus;
  bonus_point_enabled: boolean;
  bracket_frame_count: number;
  double_grand_final: boolean;
  lane_count: number;
  team_size: number;
  team_assignment: TeamAssignment;
}

export async function getEventBracketConfig(
  ex: Executor,
  eventId: string,
  opts: { lock?: 'share' | 'update' } = {}
): Promise<EventBracketConfig | null> {
  const query = ex.select({
    id: events.id,
    status: events.status,
    bonus_point_enabled: events.bonus_point_enabled,
    bracket_frame_count: events.bracket_frame_count,
    double_grand_final: events.double_grand_final,
    lane_count: events.lane_count,
    team_size: events.team_size,
    team_assignment: events.team_assignment,
  }).from(events).where(eq(events.id, eventId));
  const rows = opts.lock ? await query.for(opts.lock) : await query;
  return rows[0] ?? null;
}

export async function setEventStatus(ex: Executor, eventId: string, status: EventStatus): Promise<void> {
  await ex.update(events).set({ status }).where(eq(events.id, eventId));
}

export async function updateEventSettings(
  ex: Executor,
  eventId: string,
  patch: { status?: EventStatus; double_grand_final?: boolean }
): Promise<void> {
  if (Object.keys(patch).length > 0) await ex.update(events).set(patch).where(eq(events.id, eventId));
}

export interface EventAccess {
  id: string;
  league_id: string;
  status: EventStatus;
  qualification_round_enabled: boolean;
  admin_role: LeagueAdminRole | null;
}

export async function getEventAccess(ex: Executor, eventId: string, userId: string | null): Promise<EventAccess | null> {
  const rows = await ex.select({
    id: events.id,
    league_id: events.league_id,
    status: events.status,
    qualification_round_enabled: events.qualification_round_enabled,
    admin_role: league_admins.role,
  }).from(events).leftJoin(
    league_admins,
    and(eq(league_admins.league_id, events.league_id), userId === null ? sql`false` : eq(league_admins.user_id, userId))
  ).where(eq(events.id, eventId)).limit(1);
  return rows[0] ?? null;
}
