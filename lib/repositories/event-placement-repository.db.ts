import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { event_placements, event_players, players, team_members, teams } from '@/lib/db/schema';

export interface EventPlacementRow { eventId: string; teamId: string; placement: number }
export type EventPlacement = EventPlacementRow;

export async function getStoredPlacementsForEvents(ex: Executor, eventIds: string[]): Promise<EventPlacement[]> {
  if (eventIds.length === 0) return [];
  return ex.select({ eventId: event_placements.event_id, teamId: event_placements.team_id, placement: event_placements.placement })
    .from(event_placements).where(inArray(event_placements.event_id, eventIds));
}

export async function getEventsWithStoredPlacements(ex: Executor, eventIds: string[]): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const rows = await ex.selectDistinct({ eventId: event_placements.event_id }).from(event_placements)
    .where(inArray(event_placements.event_id, eventIds));
  return new Set(rows.map((row) => row.eventId));
}

export async function upsertEventPlacements(ex: Executor, placements: EventPlacementRow[]): Promise<void> {
  if (placements.length === 0) return;
  await ex.insert(event_placements).values(placements.map((placement) => ({
    event_id: placement.eventId,
    team_id: placement.teamId,
    placement: placement.placement,
  }))).onConflictDoUpdate({
    target: [event_placements.event_id, event_placements.team_id],
    set: { placement: sql`excluded.placement` },
  });
}

export interface PlacedPlayer { teamId: string; placement: number; playerId: string }

/**
 * One row per player on a placed team: event_placements → teams → team_members →
 * event_players → players. Placements are per team; this resolves them to players.
 */
export async function getPlacedPlayers(ex: Executor, eventId: string): Promise<PlacedPlayer[]> {
  return ex.select({ teamId: teams.id, placement: event_placements.placement, playerId: players.id })
    .from(event_placements)
    .innerJoin(teams, eq(teams.id, event_placements.team_id))
    .innerJoin(team_members, eq(team_members.team_id, teams.id))
    .innerJoin(event_players, eq(event_players.id, team_members.event_player_id))
    .innerJoin(players, eq(players.id, event_players.player_id))
    .where(and(
      eq(event_placements.event_id, eventId),
      eq(teams.event_id, eventId),
      eq(event_players.event_id, eventId)
    ));
}
