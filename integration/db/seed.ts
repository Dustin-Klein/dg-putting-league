/**
 * Seed builders for integration tests. Every builder creates fresh rows with unique
 * names, so tests can run in parallel and against a database with other data.
 * Committed seeds are removed with `cleanupLeague`.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import {
  bracket_group,
  bracket_match,
  bracket_participant,
  bracket_round,
  bracket_stage,
  event_players,
  events,
  lanes,
  leagues,
  players,
  team_members,
  teams,
} from '@/lib/db/schema';
import { startBracket } from '@/lib/services/event/event-service';
import type { PoolAssignment } from '@/lib/services/event-player';
import type { TeamPairing } from '@/lib/services/team';
import type { EventStatus } from '@/lib/types/event';

function uniqueSuffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

export async function seedLeague(ex: Executor): Promise<{ leagueId: string }> {
  const [league] = await ex
    .insert(leagues)
    .values({ name: `Integration ${uniqueSuffix()}`, city: 'Testville' })
    .returning({ id: leagues.id });
  return { leagueId: league.id };
}

export interface SeedEventOptions {
  players: number;
  status?: EventStatus;
  laneCount?: number;
  bonusPointEnabled?: boolean;
  bracketFrameCount?: number;
  doubleGrandFinal?: boolean;
  leagueId?: string;
}

export interface SeededEvent {
  leagueId: string;
  eventId: string;
  accessCode: string;
  /** event_players ids, in player order */
  eventPlayerIds: string[];
  playerIds: string[];
  playerNames: string[];
}

export async function seedEvent(ex: Executor, opts: SeedEventOptions): Promise<SeededEvent> {
  const leagueId = opts.leagueId ?? (await seedLeague(ex)).leagueId;
  const accessCode = `it${uniqueSuffix()}`;

  const [event] = await ex
    .insert(events)
    .values({
      league_id: leagueId,
      event_date: '2026-10-08',
      location: 'Integration test',
      lane_count: opts.laneCount ?? 1,
      putt_distance_ft: '25',
      access_code: accessCode,
      bonus_point_enabled: opts.bonusPointEnabled ?? true,
      bracket_frame_count: opts.bracketFrameCount ?? 5,
      double_grand_final: opts.doubleGrandFinal ?? true,
      status: opts.status ?? 'pre-bracket',
      // drizzle-kit renders these numeric NULL defaults as the string 'NULL'; pass them explicitly.
      entry_fee_per_player: null,
      admin_fees: null,
      admin_fee_per_player: null,
      payout_pool_override: null,
    })
    .returning({ id: events.id });

  const suffix = uniqueSuffix();
  const playerNames = Array.from({ length: opts.players }, (_, i) => `P${i + 1} ${suffix}`);
  const insertedPlayers =
    opts.players === 0
      ? []
      : await ex
          .insert(players)
          .values(playerNames.map((full_name) => ({ full_name })))
          .returning({ id: players.id });
  const playerIds = insertedPlayers.map((p) => p.id);

  const insertedEntries =
    playerIds.length === 0
      ? []
      : await ex
          .insert(event_players)
          .values(playerIds.map((player_id) => ({ event_id: event.id, player_id, payment_type: 'cash' })))
          .returning({ id: event_players.id, player_id: event_players.player_id });
  const entryByPlayer = new Map(insertedEntries.map((e) => [e.player_id, e.id]));

  return {
    leagueId,
    eventId: event.id,
    accessCode,
    eventPlayerIds: playerIds.map((id) => entryByPlayer.get(id)!),
    playerIds,
    playerNames,
  };
}

/**
 * Deterministic pools and pairings: the first half of the players is pool A, the
 * second half pool B; team i pairs A[i] with B[i] and is seeded i + 1.
 */
export function buildDeterministicPairings(event: SeededEvent): {
  poolAssignments: PoolAssignment[];
  teamPairings: TeamPairing[];
} {
  const half = event.eventPlayerIds.length / 2;
  const poolAssignments: PoolAssignment[] = event.eventPlayerIds.map((eventPlayerId, i) => ({
    eventPlayerId,
    playerId: event.playerIds[i],
    playerName: event.playerNames[i],
    pool: i < half ? 'A' : 'B',
    pfaScore: 100 - i,
    scoringMethod: 'default',
    defaultPool: i < half ? 'A' : 'B',
  }));
  const teamPairings: TeamPairing[] = Array.from({ length: half }, (_, i) => ({
    seed: i + 1,
    poolCombo: `${event.playerNames[i]} & ${event.playerNames[i + half]}`,
    combinedScore: 200 - 2 * i,
    members: [
      { eventPlayerId: event.eventPlayerIds[i], slot: 1 },
      { eventPlayerId: event.eventPlayerIds[i + half], slot: 2 },
    ],
  }));
  return { poolAssignments, teamPairings };
}

export interface SeedBracketOptions {
  teams: number;
  laneCount?: number;
  doubleGrandFinal?: boolean;
  bonusPointEnabled?: boolean;
  bracketFrameCount?: number;
}

/**
 * A pre-bracket event with 2 × `teams` paid players, started through the real
 * start-bracket flow (`startBracket`).
 */
export async function seedBracket(ex: Executor, opts: SeedBracketOptions): Promise<SeededEvent> {
  const event = await seedEvent(ex, {
    players: opts.teams * 2,
    laneCount: opts.laneCount ?? 1,
    doubleGrandFinal: opts.doubleGrandFinal,
    bonusPointEnabled: opts.bonusPointEnabled,
    bracketFrameCount: opts.bracketFrameCount,
  });
  const { poolAssignments, teamPairings } = buildDeterministicPairings(event);
  await startBracket(ex, event.eventId, poolAssignments, teamPairings);
  return event;
}

/**
 * Remove a committed seed: the league (events and everything below cascade) and its players.
 */
export async function cleanupLeague(ex: Executor, seeded: { leagueId: string; playerIds?: string[] }): Promise<void> {
  await ex.delete(leagues).where(eq(leagues.id, seeded.leagueId));
  if (seeded.playerIds && seeded.playerIds.length > 0) {
    await ex.delete(players).where(inArray(players.id, seeded.playerIds));
  }
}

// ---------------------------------------------------------------------------
// Read helpers for assertions
// ---------------------------------------------------------------------------

export type MatchRow = typeof bracket_match.$inferSelect;
export type Opponent = { id?: number | null; score?: number; result?: string; position?: number } | null;

export interface BracketSnapshot {
  stageId: number;
  matches: Array<MatchRow & { group_number: number; round_number: number }>;
  participants: Array<{ id: number; team_id: string | null; name: string }>;
  lanes: Array<{ id: string; label: string; status: string; maintenance_pending: boolean }>;
}

export async function getBracketSnapshot(ex: Executor, eventId: string): Promise<BracketSnapshot> {
  const [stage] = await ex
    .select({ id: bracket_stage.id })
    .from(bracket_stage)
    .where(eq(bracket_stage.tournament_id, eventId));
  if (!stage) throw new Error(`No bracket for event ${eventId}`);

  const rows = await ex
    .select({ match: bracket_match, group_number: bracket_group.number, round_number: bracket_round.number })
    .from(bracket_match)
    .innerJoin(bracket_round, eq(bracket_round.id, bracket_match.round_id))
    .innerJoin(bracket_group, eq(bracket_group.id, bracket_match.group_id))
    .where(eq(bracket_match.stage_id, stage.id))
    .orderBy(asc(bracket_group.number), asc(bracket_round.number), asc(bracket_match.number));

  const participants = await ex
    .select({ id: bracket_participant.id, team_id: bracket_participant.team_id, name: bracket_participant.name })
    .from(bracket_participant)
    .where(eq(bracket_participant.tournament_id, eventId))
    .orderBy(asc(bracket_participant.id));

  const laneRows = await ex
    .select({
      id: lanes.id,
      label: lanes.label,
      status: lanes.status,
      maintenance_pending: lanes.maintenance_pending,
    })
    .from(lanes)
    .where(eq(lanes.event_id, eventId))
    .orderBy(asc(lanes.label));

  return {
    stageId: stage.id,
    matches: rows.map((r) => ({ ...r.match, group_number: r.group_number, round_number: r.round_number })),
    participants,
    lanes: laneRows,
  };
}

/**
 * The two event players of the team behind a bracket participant.
 */
export async function getParticipantPlayers(ex: Executor, eventId: string, participantId: number): Promise<string[]> {
  const rows = await ex
    .select({ event_player_id: team_members.event_player_id })
    .from(bracket_participant)
    .innerJoin(teams, eq(teams.id, bracket_participant.team_id))
    .innerJoin(team_members, eq(team_members.team_id, teams.id))
    .where(and(eq(bracket_participant.id, participantId), eq(bracket_participant.tournament_id, eventId)))
    .orderBy(asc(team_members.slot));
  return rows.map((r) => r.event_player_id);
}
