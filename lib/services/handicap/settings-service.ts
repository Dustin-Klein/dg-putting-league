import 'server-only';
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/errors';
import { authorizeEventAdmin, authorizeLeagueAdmin } from '@/lib/services/auth';
import { lockEvent, lockLeagueHandicap, withTransaction, type Executor } from '@/lib/db/tx';
import * as handicapDb from '@/lib/repositories/handicap-repository.db';
import * as eventDb from '@/lib/repositories/event-repository.db';
import {
  DEFAULT_HANDICAP_SETTINGS,
  DEFAULT_ZONE_LADDER,
  type EntryHandicapPatch,
  type EvaluationSummary,
  type EventZoneDistances,
  type HandicapSettings,
  type LeagueHandicapConfig,
  type ZoneDefinition,
} from '@/lib/types/handicap';
import { eventZoneDistancesError, handicapSettingsError, zoneLadderError } from './validation';
import { refreshEntrySnapshots } from './snapshot';
import { getEvaluationSummary } from './evaluate';

async function readLeagueConfig(ex: Executor, leagueId: string): Promise<LeagueHandicapConfig> {
  const [stored, zones] = await Promise.all([
    handicapDb.getLeagueHandicapSettings(ex, leagueId),
    handicapDb.getLeagueZones(ex, leagueId),
  ]);
  return {
    settings: stored?.settings ?? DEFAULT_HANDICAP_SETTINGS,
    zones: zones.length > 0 ? zones : DEFAULT_ZONE_LADDER.map((zone) => ({ ...zone })),
    configured: stored !== null,
    updated_at: stored?.updated_at ?? null,
  };
}

/** A league's handicap settings and nominal ladder; defaults until first saved. League admins only. */
export async function getHandicapSettings(leagueId: string): Promise<LeagueHandicapConfig> {
  const { pg } = await authorizeLeagueAdmin(leagueId);
  return readLeagueConfig(pg, leagueId);
}

/**
 * Save a league's settings and nominal ladder (enabling handicaps seeds the default
 * 21/27/33 ladder). Editing the ladder only changes what future events start from: no
 * period is split and no sample is invalidated. Removing or renumbering a zone that
 * a period or event entry refers to is refused.
 */
export async function updateHandicapSettings(
  leagueId: string,
  input: { settings: HandicapSettings; zones?: ZoneDefinition[] }
): Promise<LeagueHandicapConfig> {
  const { user, pg } = await authorizeLeagueAdmin(leagueId);

  return withTransaction(pg, async (tx) => {
    await lockLeagueHandicap(tx, leagueId);
    const current = await readLeagueConfig(tx, leagueId);
    const zones = [...(input.zones ?? current.zones)].sort((a, b) => a.zone - b.zone);

    const ladderError = zoneLadderError(zones);
    if (ladderError) throw new BadRequestError(ladderError);
    const settingsError = handicapSettingsError(input.settings, zones);
    if (settingsError) throw new BadRequestError(settingsError);

    const kept = new Set(zones.map((zone) => zone.zone));
    const removedInUse = [...(await handicapDb.getZonesInUse(tx, leagueId))].filter((zone) => !kept.has(zone));
    if (removedInUse.length > 0) {
      throw new ConflictError(
        `Zone ${removedInUse.sort((a, b) => a - b).join(', ')} is in use by players or events and cannot be removed`
      );
    }

    await handicapDb.upsertLeagueHandicapSettings(tx, leagueId, input.settings, user.id);
    await handicapDb.replaceLeagueZones(tx, leagueId, zones);
    return readLeagueConfig(tx, leagueId);
  });
}

export interface EventHandicapView extends EventZoneDistances {
  /** The evaluation done at completion, once the event is completed. */
  summary: EvaluationSummary | null;
}

async function readEventDistances(ex: Executor, eventId: string, leagueId: string): Promise<EventHandicapView['zones']> {
  const [eventZones, leagueZones] = await Promise.all([
    handicapDb.getEventZoneDistances(ex, eventId),
    handicapDb.getLeagueZones(ex, leagueId),
  ]);
  const league = new Map(leagueZones.map((zone) => [zone.zone, zone.distance_ft]));
  return eventZones.map((zone) => ({ ...zone, league_distance_ft: league.get(zone.zone) ?? null }));
}

/** An event's handicap setup and, once completed, its evaluation summary. Event admins only. */
export async function getEventHandicap(eventId: string): Promise<EventHandicapView> {
  const { pg } = await authorizeEventAdmin(eventId);
  const event = await handicapDb.getEventHandicapContext(pg, eventId);
  if (!event) throw new NotFoundError('Event not found');
  const [zones, hasFrames, summary] = await Promise.all([
    readEventDistances(pg, eventId, event.league_id),
    handicapDb.eventHasFrames(pg, eventId),
    event.status === 'completed' && event.handicap_enabled ? getEvaluationSummary(pg, eventId) : Promise.resolve(null),
  ]);
  return {
    event_id: eventId,
    handicap_enabled: event.handicap_enabled,
    zones,
    editable: event.handicap_enabled && isBeforeBracket(event.status) && !hasFrames,
    summary,
  };
}

function isBeforeBracket(status: string): boolean {
  return status === 'created' || status === 'pre-bracket';
}

/**
 * Set what each zone measures at this event. Allowed until the event's first frame;
 * the zones must be the league's, increasing, with the minimum step. Entries are
 * re-snapshotted to the new distances.
 */
export async function updateEventZoneDistances(
  eventId: string,
  zones: ZoneDefinition[]
): Promise<EventHandicapView> {
  const { pg } = await authorizeEventAdmin(eventId);

  await withTransaction(pg, async (tx) => {
    // The event row lock serializes with qualification scoring (which reads it FOR SHARE).
    await lockEvent(tx, eventId);
    const config = await eventDb.getEventBracketConfig(tx, eventId, { lock: 'update' });
    const event = await handicapDb.getEventHandicapContext(tx, eventId);
    if (!config || !event) throw new NotFoundError('Event not found');
    if (!event.handicap_enabled) throw new BadRequestError('This event does not use handicaps');
    if (!isBeforeBracket(event.status) || (await handicapDb.eventHasFrames(tx, eventId))) {
      throw new ConflictError('Zone distances are fixed once the first frame has been recorded');
    }

    const leagueZones = await handicapDb.getLeagueZones(tx, event.league_id);
    const error = eventZoneDistancesError(zones, leagueZones);
    if (error) throw new BadRequestError(error);

    await handicapDb.replaceEventZoneDistances(tx, eventId, [...zones].sort((a, b) => a.zone - b.zone));
    await refreshEntrySnapshots(tx, eventId);
  });

  return getEventHandicap(eventId);
}

/**
 * Per-entry handicap controls. A distance override is allowed only while the entry
 * has no frames (after that it would misreport what the player physically did);
 * `exclude_from_handicap` stays editable after scoring, since it records a judgement
 * about the entry. Passing `putt_distance_ft: null` clears an override.
 */
export async function updateEntryHandicap(
  eventId: string,
  eventPlayerId: string,
  patch: EntryHandicapPatch
): Promise<void> {
  const { pg } = await authorizeEventAdmin(eventId);

  await withTransaction(pg, async (tx) => {
    await lockEvent(tx, eventId);
    const config = await eventDb.getEventBracketConfig(tx, eventId, { lock: 'share' });
    const event = await handicapDb.getEventHandicapContext(tx, eventId);
    if (!config || !event) throw new NotFoundError('Event not found');
    const [entry] = await handicapDb.getEntrySnapshotStates(tx, eventId, [eventPlayerId]);
    if (!entry) throw new NotFoundError('Player not found in this event');

    if (patch.exclude_from_handicap !== undefined || patch.note !== undefined) {
      if (!event.handicap_enabled) throw new BadRequestError('This event does not use handicaps');
      await handicapDb.setEntryExclusion(tx, eventId, eventPlayerId, {
        ...(patch.exclude_from_handicap !== undefined ? { exclude_from_handicap: patch.exclude_from_handicap } : {}),
        ...(patch.note !== undefined ? { handicap_note: patch.note?.trim() || null } : {}),
      });
    }

    if (patch.putt_distance_ft !== undefined) {
      if (!isBeforeBracket(event.status) || entry.has_frames) {
        throw new ConflictError("A player's distance is fixed once they have recorded a frame");
      }
      if (patch.putt_distance_ft === null) {
        await handicapDb.applyEntrySnapshots(tx, eventId, [{
          id: entry.id,
          zone: entry.zone,
          zone_period_id: entry.zone_period_id,
          putt_distance_ft: entry.putt_distance_ft,
          distance_override: false,
        }]);
        await refreshEntrySnapshots(tx, eventId, { entryIds: [entry.id] });
      } else {
        const updated = await handicapDb.applyEntrySnapshots(tx, eventId, [{
          id: entry.id,
          zone: entry.zone,
          zone_period_id: entry.zone_period_id,
          putt_distance_ft: patch.putt_distance_ft,
          distance_override: true,
        }]);
        if (updated.length === 0) {
          throw new ConflictError("A player's distance is fixed once they have recorded a frame");
        }
      }
    }
  });
}
