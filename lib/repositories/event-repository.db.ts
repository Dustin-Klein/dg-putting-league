import 'server-only';
import { eq } from 'drizzle-orm';
import type { Executor } from '@/lib/db/tx';
import { events } from '@/lib/db/schema';
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
