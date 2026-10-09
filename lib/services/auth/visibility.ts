import type { EventStatus } from '@/lib/types/event';

/**
 * What anonymous visitors may see, as code. The server reads as `app_server`, which
 * bypasses RLS, so every public read checks one of these before returning data.
 * They mirror the SELECT policies in supabase/migrations, which still protect
 * direct browser access (Realtime).
 */
export interface EventVisibilityFields {
  status: EventStatus;
  qualification_round_enabled: boolean;
}

/** Event details and its players: scoring has started or the event is over. */
export function isEventPubliclyVisible(e: EventVisibilityFields): boolean {
  return (
    e.status === 'bracket' ||
    e.status === 'completed' ||
    (e.status === 'pre-bracket' && e.qualification_round_enabled)
  );
}

/** Bracket structure, teams and matches. */
export function isBracketPubliclyVisible(e: EventVisibilityFields): boolean {
  return e.status === 'bracket' || e.status === 'completed';
}

/** Lanes: only while the bracket is being played. */
export function isLanesPubliclyVisible(e: EventVisibilityFields): boolean {
  return e.status === 'bracket';
}

/** Qualification rounds and frames: only while qualification is running. */
export function isQualificationPubliclyVisible(e: EventVisibilityFields): boolean {
  return e.status === 'pre-bracket' && e.qualification_round_enabled;
}

export type EventVisibilityScope = 'event' | 'bracket' | 'lanes' | 'qualification';

export function isPubliclyVisible(e: EventVisibilityFields, scope: EventVisibilityScope): boolean {
  switch (scope) {
    case 'event':
      return isEventPubliclyVisible(e);
    case 'bracket':
      return isBracketPubliclyVisible(e);
    case 'lanes':
      return isLanesPubliclyVisible(e);
    case 'qualification':
      return isQualificationPubliclyVisible(e);
  }
}
