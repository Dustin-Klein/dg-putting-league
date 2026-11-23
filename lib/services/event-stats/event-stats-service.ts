import 'server-only';
import { authorizeEventAdmin, authorizeEventView, type Db } from '@/lib/services/auth/auth-service';
import { isBracketPubliclyVisible } from '@/lib/services/auth/visibility';
import { withTransaction, type Executor } from '@/lib/db/tx';
import * as statsDb from '@/lib/repositories/event-stats-repository.db';
import { getEventEvaluations } from '@/lib/repositories/handicap-repository.db';
import { BadRequestError, NotFoundError } from '@/lib/errors';
import type { AdminEventStats, PublicEventStats } from '@/lib/types/event-stats';
import { buildAnalytics, buildEntryFlags, buildEvaluations, buildQualification } from './admin';
import { buildEventStats } from './build';
import { CoalescingCache } from './cache';
import { toPublicEventStats } from './public-mapper';
import { buildSeasonContext, type SeasonContext, type SeasonTarget } from './season';

/** One consistent snapshot per request: player, team, field and match numbers can't disagree mid-score. */
const SNAPSHOT = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/** Live pages poll every ~30 s; a short shared cache keeps a crowd to one query per instance. */
const PUBLIC_TTL_MS = 10_000;
/** Season context changes only when an earlier event completes. */
const SEASON_TTL_MS = 5 * 60_000;

const publicCache = new CoalescingCache<PublicEventStats>(PUBLIC_TTL_MS);
const seasonCache = new CoalescingCache<SeasonContext>(SEASON_TTL_MS);

/** For tests. */
export function _clearEventStatsCaches(): void {
  publicCache.clear();
  seasonCache.clear();
}

function seasonTargets(snapshot: statsDb.EventStatsSnapshot): SeasonTarget[] {
  const handicap = snapshot.event.handicap_enabled;
  const zoneDistance = new Map(snapshot.zoneDistances.map((zone) => [zone.zone, zone.distance_ft]));
  return snapshot.entries.map((entry) => ({
    playerId: entry.player_id,
    zone: handicap ? entry.zone : null,
    distanceFt: handicap && entry.zone !== null ? zoneDistance.get(entry.zone) ?? entry.putt_distance_ft : entry.putt_distance_ft,
  }));
}

async function loadSeason(ex: Executor, snapshot: statsDb.EventStatsSnapshot): Promise<SeasonContext> {
  const targets = seasonTargets(snapshot);
  const rows = await statsDb.getSeasonCounts(ex, snapshot.event, targets.map((t) => t.playerId));
  const fieldRows = await statsDb.getFieldSeasonCounts(ex, snapshot.event);
  return buildSeasonContext(rows, fieldRows, targets, {
    handicap: snapshot.event.handicap_enabled,
    framesPerMatch: snapshot.event.bracket_frame_count,
  });
}

function seasonKey(snapshot: statsDb.EventStatsSnapshot): string {
  return `${snapshot.event.id}:${snapshot.entries.map((e) => `${e.player_id}/${e.zone ?? ''}/${e.putt_distance_ft}`).sort().join(',')}`;
}

async function loadPublicEventStats(pg: Db, eventId: string): Promise<PublicEventStats> {
  const snapshot = await withTransaction(pg, (tx) => statsDb.getEventStatsSnapshot(tx, eventId), SNAPSHOT);
  if (!snapshot) throw new NotFoundError('Event not found');
  const season = await seasonCache.get(seasonKey(snapshot), () => loadSeason(pg, snapshot));
  const model = buildEventStats(snapshot, season);
  return toPublicEventStats(model, { parent: snapshot.parent, children: snapshot.children }, new Date().toISOString());
}

/**
 * The public event report, visible with the bracket (bracket play or completed).
 * Behind a ~10 s shared cache; authorization runs on every call, before the cache.
 */
export async function getPublicEventStats(eventId: string): Promise<PublicEventStats> {
  const { event, pg } = await authorizeEventView(eventId, 'bracket');
  // Admins may view private events elsewhere, but this report only exists with a bracket.
  if (!isBracketPubliclyVisible(event)) throw new NotFoundError('Event not found');
  return publicCache.get(eventId, () => loadPublicEventStats(pg, eventId));
}

/** The admin report: everything public plus organizer-only data. Never cached. */
export async function getAdminEventStats(eventId: string): Promise<AdminEventStats> {
  const { event, pg } = await authorizeEventAdmin(eventId);
  if (!isBracketPubliclyVisible(event)) {
    throw new BadRequestError('Event stats are available once bracket play starts');
  }

  const data = await withTransaction(pg, async (tx) => {
    const snapshot = await statsDb.getEventStatsSnapshot(tx, eventId);
    if (!snapshot) throw new NotFoundError('Event not found');
    const admin = await statsDb.getEventStatsAdminData(tx, eventId);
    const evaluations = snapshot.event.handicap_enabled && snapshot.event.status === 'completed'
      ? await getEventEvaluations(tx, eventId)
      : [];
    const season = await loadSeason(tx, snapshot);
    const history = await statsDb.getLeagueHistoryEntries(tx, snapshot.event);
    return { snapshot, admin, evaluations, season, history };
  }, SNAPSHOT);

  const { snapshot, admin, evaluations, season, history } = data;
  const model = buildEventStats(snapshot, season);
  const report = toPublicEventStats(model, { parent: snapshot.parent, children: snapshot.children }, new Date().toISOString());
  return {
    ...report,
    parent: snapshot.parent && snapshot.event.link_type
      ? { id: snapshot.parent.id, link_type: snapshot.event.link_type, event_date: snapshot.parent.event_date }
      : null,
    children: snapshot.children
      .filter((child) => child.link_type !== null)
      .map((child) => ({ id: child.id, link_type: child.link_type!, event_date: child.event_date, status: child.status })),
    warnings: model.warnings,
    entry_flags: buildEntryFlags(snapshot, admin),
    teams: model.teams,
    qualification: buildQualification(snapshot, admin),
    evaluations: buildEvaluations(report.event.status, snapshot.event.handicap_enabled, evaluations),
    analytics: buildAnalytics({ snapshot, entryStats: model.entryStats, teams: model.teams, season, history }),
  };
}
