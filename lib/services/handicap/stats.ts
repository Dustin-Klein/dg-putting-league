/**
 * Handicap stat definitions: the single source of truth (plan 06 §5).
 *
 * For a set of event entries:
 * - putts_attempted = 3 × frame_results rows (+ 3 × qualification_frames rows when
 *   qualification putts count). Overtime frames count; only rows that exist count.
 * - putts_made      = sum of putts_made over the same rows
 * - make_pct        = putts_made / putts_attempted × 100, null when nothing was attempted
 * - matches         = distinct bracket matches with status Completed (4) or Archived (5)
 *                     in which the player has at least one frame result
 *
 * The bonus point never enters make %: it is computed from putts, not points.
 * Pure functions only; the aggregate queries live in handicap-repository.db.ts.
 */
import type { EligibilityProgress, HandicapSettings, PeriodStats } from '@/lib/types/handicap';

export const PUTTS_PER_FRAME = 3;

/** One event entry's raw counts, as the aggregate query returns them. */
export interface EntryCounts {
  event_id: string;
  /** For newest-first ordering of the rolling window. */
  event_date: string;
  event_created_at: string;
  frames: number;
  frame_putts_made: number;
  qualification_frames: number;
  qualification_putts_made: number;
  matches: number;
}

export const EMPTY_STATS: PeriodStats = {
  putts_made: 0,
  putts_attempted: 0,
  make_pct: null,
  matches: 0,
  events: 0,
};

export function makePct(made: number, attempted: number): number | null {
  if (attempted <= 0) return null;
  return Math.round((made / attempted) * 10000) / 100;
}

function entryPutts(entry: EntryCounts, countQualification: boolean): { made: number; attempted: number } {
  const frames = entry.frames + (countQualification ? entry.qualification_frames : 0);
  const made = entry.frame_putts_made + (countQualification ? entry.qualification_putts_made : 0);
  return { made, attempted: frames * PUTTS_PER_FRAME };
}

/** Newest event first: by event date, then by creation (two events on one night). */
function newestFirst(a: EntryCounts, b: EntryCounts): number {
  if (a.event_date !== b.event_date) return a.event_date < b.event_date ? 1 : -1;
  if (a.event_created_at !== b.event_created_at) return a.event_created_at < b.event_created_at ? 1 : -1;
  return a.event_id < b.event_id ? 1 : -1;
}

/**
 * Combine one period's entries into its stats. With a rolling window, only the most
 * recent `window_putts` putts count, taking whole events newest first: the event that
 * crosses the boundary is included in full, so the number stays explainable.
 */
export function combinePeriodStats(
  entries: readonly EntryCounts[],
  settings: Pick<HandicapSettings, 'count_qualification_putts' | 'window_putts'>
): PeriodStats {
  const ordered = [...entries].sort(newestFirst);
  let made = 0;
  let attempted = 0;
  let matches = 0;
  let events = 0;
  for (const entry of ordered) {
    if (settings.window_putts !== null && attempted >= settings.window_putts) break;
    const putts = entryPutts(entry, settings.count_qualification_putts);
    if (putts.attempted === 0 && entry.matches === 0) continue;
    made += putts.made;
    attempted += putts.attempted;
    matches += entry.matches;
    events += 1;
  }
  return { putts_made: made, putts_attempted: attempted, make_pct: makePct(made, attempted), matches, events };
}

/**
 * Whether a sample is large enough to decide on. A minimum of 0 means the criterion
 * is disabled, not satisfied: a bare `x >= 0` is always true, which would let one
 * zero minimum switch the other criterion off and make everyone eligible at once.
 */
export function isEligible(stats: PeriodStats, settings: Pick<HandicapSettings, 'min_putts' | 'min_matches'>): boolean {
  const byPutts = settings.min_putts > 0 && stats.putts_attempted >= settings.min_putts;
  const byMatches = settings.min_matches > 0 && stats.matches >= settings.min_matches;
  return byPutts || byMatches;
}

export function eligibilityProgress(
  stats: PeriodStats,
  settings: Pick<HandicapSettings, 'min_putts' | 'min_matches'>
): EligibilityProgress {
  return {
    eligible: isEligible(stats, settings),
    putts_remaining: settings.min_putts > 0 ? Math.max(0, settings.min_putts - stats.putts_attempted) : null,
    matches_remaining: settings.min_matches > 0 ? Math.max(0, settings.min_matches - stats.matches) : null,
  };
}
