import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { events, league_admins } from '@/lib/db/schema';
import type { LeagueAdminRole } from './league-repository.db';
import type { AccessCodeEvent } from './event-repository';

/**
 * Get the event an access code belongs to.
 * `accessCode` must already be normalized; it is matched exactly (never with LIKE).
 */
export async function getEventByAccessCode(
  ex: Executor,
  accessCode: string
): Promise<AccessCodeEvent | null> {
  const rows = await ex
    .select({
      id: events.id,
      event_date: events.event_date,
      location: events.location,
      lane_count: events.lane_count,
      bonus_point_enabled: events.bonus_point_enabled,
      bracket_frame_count: events.bracket_frame_count,
      qualification_round_enabled: events.qualification_round_enabled,
      qualification_frame_count: events.qualification_frame_count,
      status: events.status,
    })
    .from(events)
    .where(eq(events.access_code, accessCode))
    .limit(1);

  return rows[0] ?? null;
}

export interface EventBracketConfig {
  id: string;
  status: AccessCodeEvent['status'];
  bonus_point_enabled: boolean;
  bracket_frame_count: number;
  double_grand_final: boolean;
  lane_count: number;
}

/**
 * Read the settings that scoring and bracket flows depend on. Call inside the
 * transaction so the checks see the same state the writes do. `lock: 'share'`
 * holds the event row until commit, so the event can't change status (e.g. be
 * completed) under a write that already checked it.
 */
export async function getEventBracketConfig(
  ex: Executor,
  eventId: string,
  opts: { lock?: 'share' | 'update' } = {}
): Promise<EventBracketConfig | null> {
  const query = ex
    .select({
      id: events.id,
      status: events.status,
      bonus_point_enabled: events.bonus_point_enabled,
      bracket_frame_count: events.bracket_frame_count,
      double_grand_final: events.double_grand_final,
      lane_count: events.lane_count,
    })
    .from(events)
    .where(eq(events.id, eventId));

  const rows = opts.lock ? await query.for(opts.lock) : await query;
  return rows[0] ?? null;
}

export async function setEventStatus(
  ex: Executor,
  eventId: string,
  status: AccessCodeEvent['status']
): Promise<void> {
  await ex.update(events).set({ status }).where(eq(events.id, eventId));
}

export async function updateEventSettings(
  ex: Executor,
  eventId: string,
  patch: { status?: AccessCodeEvent['status']; double_grand_final?: boolean }
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await ex.update(events).set(patch).where(eq(events.id, eventId));
}

export interface EventAccess {
  id: string;
  league_id: string;
  status: AccessCodeEvent['status'];
  qualification_round_enabled: boolean;
  /** The viewer's role in the event's league; null for anonymous viewers and non-admins. */
  admin_role: LeagueAdminRole | null;
}

/**
 * Load what authorization needs about an event and the viewer in one query.
 */
export async function getEventAccess(
  ex: Executor,
  eventId: string,
  userId: string | null
): Promise<EventAccess | null> {
  const rows = await ex
    .select({
      id: events.id,
      league_id: events.league_id,
      status: events.status,
      qualification_round_enabled: events.qualification_round_enabled,
      admin_role: league_admins.role,
    })
    .from(events)
    .leftJoin(
      league_admins,
      and(
        eq(league_admins.league_id, events.league_id),
        userId === null ? sql`false` : eq(league_admins.user_id, userId)
      )
    )
    .where(eq(events.id, eventId))
    .limit(1);
  return rows[0] ?? null;
}
