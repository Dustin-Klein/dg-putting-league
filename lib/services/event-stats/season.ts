/**
 * Season context: the same player's results in every earlier completed event of the
 * league (league to date, no window), compared like with like:
 * - handicap events: frames in the same zone, leaving out frames more than the ladder
 *   warning (2 ft) from that event's distance for the zone;
 * - other events: frames at the same actual distance.
 * Normalized with this event's frames per match. Make % skips events without reliable
 * putt counts; points keep them. Below 10 frames the line shows "—".
 */
import { ZONE_DISTANCE_WARN_FT } from '@/lib/types/handicap';
import type { SeasonLine } from '@/lib/types/event-stats';
import type { FieldSeasonRow, SeasonCountsRow } from '@/lib/repositories/event-stats-repository.db';
import { formatDistanceLabel } from './labels';
import { isSmallSample, makeRate, normalizedPoints } from './metrics';

export const SEASON_DISTANCE_TOLERANCE_FT = ZONE_DISTANCE_WARN_FT;

export interface SeasonCounts {
  frames: number;
  points: number;
  reliableFrames: number;
  reliableMade: number;
}

export interface SeasonTarget {
  playerId: string;
  /** Entry zone in a handicap event, else null. */
  zone: number | null;
  /** This event's distance for that zone (handicap) or the entry's distance. */
  distanceFt: number;
}

export interface SeasonContext {
  players: Map<string, { counts: SeasonCounts; line: SeasonLine }>;
  field: SeasonLine | null;
}

function emptySeason(): SeasonCounts {
  return { frames: 0, points: 0, reliableFrames: 0, reliableMade: 0 };
}

function matches(row: SeasonCountsRow, target: SeasonTarget, handicap: boolean): boolean {
  if (!handicap) return row.distance_ft === target.distanceFt;
  if (row.zone === null || row.zone !== target.zone || row.nominal_ft === null) return false;
  return Math.abs(row.distance_ft - row.nominal_ft) <= SEASON_DISTANCE_TOLERANCE_FT;
}

export function seasonLine(counts: SeasonCounts, label: string, framesPerMatch: number): SeasonLine {
  return {
    label,
    frames: counts.frames,
    make_rate: isSmallSample(counts.reliableFrames) ? null : makeRate(counts.reliableMade, counts.reliableFrames),
    points_per_match: isSmallSample(counts.frames) ? null : normalizedPoints(counts.points, counts.frames, framesPerMatch),
  };
}

export function buildSeasonContext(
  rows: readonly SeasonCountsRow[],
  fieldRows: readonly FieldSeasonRow[],
  targets: readonly SeasonTarget[],
  opts: { handicap: boolean; framesPerMatch: number }
): SeasonContext {
  const byPlayer = new Map<string, SeasonCountsRow[]>();
  for (const row of rows) {
    const list = byPlayer.get(row.player_id) ?? [];
    list.push(row);
    byPlayer.set(row.player_id, list);
  }

  const players = new Map<string, { counts: SeasonCounts; line: SeasonLine }>();
  for (const target of targets) {
    const counts = emptySeason();
    for (const row of byPlayer.get(target.playerId) ?? []) {
      if (!matches(row, target, opts.handicap)) continue;
      counts.frames += row.frames;
      counts.points += row.points;
      if (row.reliable) {
        counts.reliableFrames += row.frames;
        counts.reliableMade += row.made;
      }
    }
    const label = target.zone !== null
      ? `Zone ${target.zone} (${formatDistanceLabel(target.distanceFt)})`
      : formatDistanceLabel(target.distanceFt);
    players.set(target.playerId, { counts, line: seasonLine(counts, label, opts.framesPerMatch) });
  }

  const field = emptySeason();
  for (const row of fieldRows) {
    field.frames += row.frames;
    field.points += row.points;
    if (row.reliable) {
      field.reliableFrames += row.frames;
      field.reliableMade += row.made;
    }
  }

  return {
    players,
    field: field.frames > 0 ? seasonLine(field, 'All distances', opts.framesPerMatch) : null,
  };
}
