import { format } from 'date-fns';
import type { EligibilityProgress, PeriodStats, ZoneChangeReason } from '@/lib/types/handicap';

/** An ISO timestamp as "Sep 2, 2026" in local time. */
export function formatTimestampDate(iso: string): string {
  return format(new Date(iso), 'MMM d, yyyy');
}

export function formatPct(pct: number | null | undefined): string {
  return pct === null || pct === undefined ? '–' : `${pct.toFixed(1)}%`;
}

/** "34/52 – 65.4% · 3 matches" */
export function formatPeriodStats(stats: PeriodStats): string {
  const matches = `${stats.matches} ${stats.matches === 1 ? 'match' : 'matches'}`;
  return `${stats.putts_made}/${stats.putts_attempted} – ${formatPct(stats.make_pct)} · ${matches}`;
}

/** "Eligible after 16 more putts or 1 more match", or null once eligible. */
export function eligibilityText(progress: EligibilityProgress): string | null {
  if (progress.eligible) return null;
  const parts: string[] = [];
  if (progress.putts_remaining !== null) {
    parts.push(`${progress.putts_remaining} more ${progress.putts_remaining === 1 ? 'putt' : 'putts'}`);
  }
  if (progress.matches_remaining !== null) {
    parts.push(`${progress.matches_remaining} more ${progress.matches_remaining === 1 ? 'match' : 'matches'}`);
  }
  return parts.length > 0 ? `Eligible after ${parts.join(' or ')}` : null;
}

/**
 * How a zone change reads on the history timeline. "The system moved me" and "an
 * organizer moved me" never blur, and the player-facing text never says why: the
 * reason is in the admin-only note.
 */
export function zoneChangeLabel(reason: ZoneChangeReason, zone: number, previousZone: number | null): string {
  switch (reason) {
    case 'initial':
      return `Started in Zone ${zone}`;
    case 'auto_promote':
      return `Moved up to Zone ${zone}`;
    case 'auto_demote':
      return `Moved to Zone ${zone} automatically`;
    case 'admin_demote':
    case 'manual':
      return previousZone !== null && zone > previousZone
        ? `Moved up to Zone ${zone} by an organizer`
        : `Moved to Zone ${zone} by an organizer`;
    case 'correction':
      return `Zone corrected to Zone ${zone}`;
  }
}
