/**
 * The zone decision (plan 06 §6), pure so the simulation script can replay history
 * with it. It returns `demote` whenever the numbers say so; whether a demotion is
 * applied or queued for an admin is the runner's call (`auto_demote_enabled`).
 *
 * Boundaries: `pct > promote_above` moves up, `pct < demote_below` moves down,
 * anything in between (both thresholds included) stays.
 */
import type { HandicapSettings, PeriodStats, ZoneDecision } from '@/lib/types/handicap';
import { isEligible } from './stats';

export interface Decision {
  action: ZoneDecision;
  eligible: boolean;
  stats: PeriodStats;
}

export function decideZoneChange(
  stats: PeriodStats,
  settings: Pick<HandicapSettings, 'min_putts' | 'min_matches' | 'promote_above_pct' | 'demote_below_pct'>,
  zone: number,
  maxZone: number
): Decision {
  const eligible = isEligible(stats, settings);
  if (!eligible || stats.make_pct === null) return { action: 'stay', eligible, stats };
  if (stats.make_pct > settings.promote_above_pct && zone < maxZone) return { action: 'promote', eligible, stats };
  if (stats.make_pct < settings.demote_below_pct && zone > 1) return { action: 'demote', eligible, stats };
  return { action: 'stay', eligible, stats };
}

/** Whether the runner applies a decision, or records it for review (a queued demotion). */
export function appliesAutomatically(
  action: ZoneDecision,
  settings: Pick<HandicapSettings, 'auto_demote_enabled'>
): boolean {
  return action === 'promote' || (action === 'demote' && settings.auto_demote_enabled);
}
