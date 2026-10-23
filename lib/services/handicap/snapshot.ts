import 'server-only';
import { InternalError } from '@/lib/errors';
import { lockLeagueHandicap, type Tx } from '@/lib/db/tx';
import * as handicapDb from '@/lib/repositories/handicap-repository.db';
import type { ZoneDefinition } from '@/lib/types/handicap';

/**
 * Entry snapshots (plan 06 §4.3). Scoring screens, stats and evaluations read an
 * entry's zone / putt_distance_ft / zone_period_id, never the player's live zone, so
 * a later zone change can't rewrite what a player did.
 *
 * Two rules:
 * 1. Refresh before the first putt: at `created → pre-bracket` (authoritative) and at
 *    bracket start (best effort), entries pick up any zone change since they were written.
 * 2. Freeze from the first recorded frame: no write changes zone, distance or period
 *    of an entry that has a frame. `applyEntrySnapshots` enforces it in SQL.
 *
 * Callers authorize and hold any event lock they need; this takes the league handicap
 * lock (last in the lock order) for handicap events.
 */

export type DistanceLookup = (zone: number) => number | undefined;

/** The distance each zone measures at this event, falling back to the league ladder. */
export function zoneDistanceLookup(
  eventZones: readonly ZoneDefinition[],
  leagueZones: readonly ZoneDefinition[]
): DistanceLookup {
  const event = new Map(eventZones.map((zone) => [zone.zone, zone.distance_ft]));
  const league = new Map(leagueZones.map((zone) => [zone.zone, zone.distance_ft]));
  return (zone) => event.get(zone) ?? league.get(zone);
}

/**
 * Bring the event's entries (or the given ones) in line with the players' current
 * zones. Entries with recorded frames are left alone. For an event without handicaps
 * every entry putts from the event distance and has no zone.
 */
export async function refreshEntrySnapshots(
  tx: Tx,
  eventId: string,
  opts: { entryIds?: readonly string[] } = {}
): Promise<void> {
  const event = await handicapDb.getEventHandicapContext(tx, eventId);
  if (!event) throw new InternalError('Event not found for snapshot');

  const states = (await handicapDb.getEntrySnapshotStates(tx, eventId, opts.entryIds))
    .filter((state) => !state.has_frames);
  if (states.length === 0) return;

  if (!event.handicap_enabled) {
    const snapshots = states
      .filter((state) =>
        state.zone !== null ||
        state.zone_period_id !== null ||
        (!state.distance_override && state.putt_distance_ft !== event.putt_distance_ft))
      .map((state) => ({
        id: state.id,
        zone: null,
        zone_period_id: null,
        putt_distance_ft: state.distance_override ? state.putt_distance_ft : event.putt_distance_ft,
        distance_override: state.distance_override,
      }));
    await handicapDb.applyEntrySnapshots(tx, eventId, snapshots);
    return;
  }

  await lockLeagueHandicap(tx, event.league_id);
  const periods = await ensureOpenPeriods(tx, event.league_id, states.map((state) => state.player_id));
  const [eventZones, leagueZones] = await Promise.all([
    handicapDb.getEventZoneDistances(tx, eventId),
    handicapDb.getLeagueZones(tx, event.league_id),
  ]);
  const distanceOf = zoneDistanceLookup(eventZones, leagueZones);

  const snapshots: handicapDb.EntrySnapshot[] = [];
  for (const state of states) {
    const period = periods.get(state.player_id);
    if (!period) throw new InternalError('Player has no open zone period');
    const zoneChanged = state.zone !== period.zone;
    // A hand-set distance survives a refresh unless the zone it was set for changed.
    const keepOverride = state.distance_override && !zoneChanged;
    const distance = keepOverride ? state.putt_distance_ft : distanceOf(period.zone) ?? period.distance_ft;
    if (
      !zoneChanged &&
      state.zone_period_id === period.id &&
      state.putt_distance_ft === distance &&
      state.distance_override === keepOverride
    ) {
      continue;
    }
    snapshots.push({
      id: state.id,
      zone: period.zone,
      zone_period_id: period.id,
      putt_distance_ft: distance,
      distance_override: keepOverride,
    });
  }
  await handicapDb.applyEntrySnapshots(tx, eventId, snapshots);
}

/**
 * Every given player's open period in the league, opening an `initial` period at the
 * league's starting zone for players who have none. Callers hold the league handicap lock.
 */
export async function ensureOpenPeriods(
  tx: Tx,
  leagueId: string,
  playerIds: readonly string[]
): Promise<Map<string, handicapDb.ZonePeriodRow>> {
  const periods = await handicapDb.getOpenPeriods(tx, leagueId, playerIds);
  const missing = [...new Set(playerIds)].filter((playerId) => !periods.has(playerId));
  if (missing.length === 0) return periods;

  const stored = await handicapDb.getLeagueHandicapSettings(tx, leagueId);
  if (!stored) throw new InternalError('Handicap event in a league without handicap settings');
  const zones = await handicapDb.getLeagueZones(tx, leagueId);
  const start = zones.find((zone) => zone.zone === stored.settings.default_zone);
  if (!start) throw new InternalError('The league starting zone has no distance');

  await handicapDb.insertOpenPeriods(tx, leagueId, missing.map((playerId) => ({
    player_id: playerId,
    zone: start.zone,
    distance_ft: start.distance_ft,
    start_reason: 'initial',
  })));
  const created = await handicapDb.getOpenPeriods(tx, leagueId, missing);
  for (const [playerId, period] of created) periods.set(playerId, period);
  return periods;
}
