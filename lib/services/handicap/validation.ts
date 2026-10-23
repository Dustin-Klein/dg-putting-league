/**
 * Settings, ladder and event-distance validation. Pure: returns an error message or
 * null, so routes, services and the settings form agree on one rule set.
 */
import {
  MAX_ZONES,
  MIN_ZONE_STEP_FT,
  ZONE_DISTANCE_WARN_FT,
  type HandicapSettings,
  type ZoneDefinition,
} from '@/lib/types/handicap';

function sortedZones(zones: readonly ZoneDefinition[]): ZoneDefinition[] {
  return [...zones].sort((a, b) => a.zone - b.zone);
}

/**
 * Zones numbered 1..N without gaps, distances strictly increasing with at least
 * MIN_ZONE_STEP_FT between neighbours. The step is what makes the handicap work.
 */
function ladderError(zones: readonly ZoneDefinition[], label: string): string | null {
  if (zones.length < 2) return `${label} needs at least 2 zones`;
  if (zones.length > MAX_ZONES) return `${label} can have at most ${MAX_ZONES} zones`;
  const sorted = sortedZones(zones);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].zone !== i + 1) return `${label}: zones must be numbered 1 to ${sorted.length} without gaps`;
    if (!(sorted[i].distance_ft > 0)) return `${label}: every distance must be greater than 0`;
    if (i > 0) {
      const step = sorted[i].distance_ft - sorted[i - 1].distance_ft;
      if (step <= 0) return `${label}: distances must increase from zone to zone`;
      if (step < MIN_ZONE_STEP_FT) {
        return `${label}: adjacent zones must be at least ${MIN_ZONE_STEP_FT} ft apart`;
      }
    }
  }
  return null;
}

export function zoneLadderError(zones: readonly ZoneDefinition[]): string | null {
  return ladderError(zones, 'Zone ladder');
}

export function handicapSettingsError(settings: HandicapSettings, zones: readonly ZoneDefinition[]): string | null {
  if (settings.demote_below_pct < 0 || settings.promote_above_pct > 100) {
    return 'Thresholds must be between 0 and 100';
  }
  if (settings.demote_below_pct >= settings.promote_above_pct) {
    return 'The demotion threshold must be below the promotion threshold';
  }
  if (settings.min_putts < 0 || settings.min_matches < 0) return 'Minimums cannot be negative';
  if (settings.min_putts === 0 && settings.min_matches === 0) {
    return 'At least one eligibility minimum (putts or matches) must be greater than 0';
  }
  if (settings.window_putts !== null && settings.window_putts <= 0) {
    return 'The rolling window must be greater than 0 putts (or off)';
  }
  if (!zones.some((zone) => zone.zone === settings.default_zone)) {
    return 'The starting zone must be one of the league zones';
  }
  return null;
}

/** An event's distances: the league's zone set, increasing, minimum step. */
export function eventZoneDistancesError(
  zones: readonly ZoneDefinition[],
  leagueZones: readonly ZoneDefinition[]
): string | null {
  const expected = leagueZones.map((zone) => zone.zone).sort((a, b) => a - b);
  const actual = zones.map((zone) => zone.zone).sort((a, b) => a - b);
  if (expected.length !== actual.length || expected.some((zone, i) => zone !== actual[i])) {
    return `Event distances must cover exactly the league's zones (${expected.join(', ')})`;
  }
  return ladderError(zones, 'Event distances');
}

/** Zones whose event distance is more than ZONE_DISTANCE_WARN_FT from the league ladder. */
export function zoneDistanceWarnings(
  zones: readonly ZoneDefinition[],
  leagueZones: readonly ZoneDefinition[]
): number[] {
  const nominal = new Map(leagueZones.map((zone) => [zone.zone, zone.distance_ft]));
  return zones
    .filter((zone) => {
      const league = nominal.get(zone.zone);
      return league !== undefined && Math.abs(zone.distance_ft - league) > ZONE_DISTANCE_WARN_FT;
    })
    .map((zone) => zone.zone);
}
