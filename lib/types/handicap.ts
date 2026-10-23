/**
 * Distance-based handicaps (plan 06). A player's zone is kept per league; the zone is
 * the unit their record is kept against, the distance is how far that zone measured
 * at one event.
 */

export type ZoneChangeReason =
  | 'initial'
  | 'auto_promote'
  | 'auto_demote'
  | 'manual'
  | 'admin_demote'
  | 'correction';

export type ZoneDecision = 'stay' | 'promote' | 'demote';
export type ZoneSuggestionResolution = 'applied' | 'dismissed' | 'superseded';
export type ZoneSkipReason = 'period_changed' | 'excluded';

export const DEFAULT_ZONE_LADDER: ReadonlyArray<ZoneDefinition> = [
  { zone: 1, distance_ft: 21 },
  { zone: 2, distance_ft: 27 },
  { zone: 3, distance_ft: 33 },
];

/** Smallest gap between adjacent zones, on the league ladder and on any event. */
export const MIN_ZONE_STEP_FT = 3;

/** Event distances further than this from the league ladder get a warning (not a block). */
export const ZONE_DISTANCE_WARN_FT = 2;

export const MAX_ZONES = 9;

export interface HandicapSettings {
  enabled: boolean;
  default_zone: number;
  demote_below_pct: number;
  promote_above_pct: number;
  /** 0 = criterion disabled. */
  min_putts: number;
  /** 0 = criterion disabled. */
  min_matches: number;
  /** Most recent putts a period's sample is truncated to (whole events); null = whole period. */
  window_putts: number | null;
  count_qualification_putts: boolean;
  auto_demote_enabled: boolean;
}

export const DEFAULT_HANDICAP_SETTINGS: HandicapSettings = {
  enabled: false,
  default_zone: 2,
  demote_below_pct: 50,
  promote_above_pct: 75,
  min_putts: 50,
  min_matches: 3,
  window_putts: 150,
  count_qualification_putts: true,
  auto_demote_enabled: false,
};

export interface ZoneDefinition {
  zone: number;
  distance_ft: number;
}

export interface LeagueHandicapConfig {
  settings: HandicapSettings;
  zones: ZoneDefinition[];
  /** False until a league admin first saves handicap settings. */
  configured: boolean;
  updated_at: string | null;
}

export interface EventZoneDistances {
  event_id: string;
  handicap_enabled: boolean;
  zones: Array<ZoneDefinition & { league_distance_ft: number | null }>;
  /** Distances can change until the event's first frame is recorded. */
  editable: boolean;
}

/** Derived stats for a set of event entries (see lib/services/handicap/stats.ts). */
export interface PeriodStats {
  putts_made: number;
  putts_attempted: number;
  /** Null when no putts were attempted. */
  make_pct: number | null;
  matches: number;
  events: number;
}

export interface EligibilityProgress {
  eligible: boolean;
  /** Null when the putt criterion is disabled. */
  putts_remaining: number | null;
  /** Null when the match criterion is disabled. */
  matches_remaining: number | null;
}

export interface ZonePeriodPublic {
  started_at: string;
  ended_at: string | null;
  zone: number;
  distance_ft: number;
  start_reason: ZoneChangeReason;
  /** Make % of the closed period (what caused the move); null while open. */
  make_pct: number | null;
}

export interface ZonePeriodAdmin extends ZonePeriodPublic {
  id: string;
  note: string | null;
  started_by_user: string | null;
  started_by_event_id: string | null;
  end_stats: (PeriodStats & { evaluated_event_id?: string | null }) | null;
}

export interface CareerDistanceStats {
  distance_ft: number;
  putts_made: number;
  putts_attempted: number;
  make_pct: number | null;
}

export interface PlayerHandicapPublic {
  league_id: string;
  league_name: string;
  current_zone: number;
  distance_ft: number;
  max_zone: number;
  period: {
    since: string;
    stats: PeriodStats;
    progress: EligibilityProgress;
  };
  /** The thresholds the player is measured against. */
  promote_above_pct: number;
  /** Nominal distance of the next zone up, when there is one. */
  next_zone_distance_ft: number | null;
  career: CareerDistanceStats[];
  history: ZonePeriodPublic[];
}

export interface PlayerHandicapAdmin extends Omit<PlayerHandicapPublic, 'history'> {
  history: ZonePeriodAdmin[];
  open_suggestion: ZoneSuggestion | null;
  demote_below_pct: number;
}

export interface ZoneEvaluation {
  id: string;
  event_id: string;
  player_id: string;
  league_id: string;
  zone_period_id: string;
  zone: number;
  stats: PeriodStats;
  decision: ZoneDecision;
  eligible: boolean;
  applied: boolean;
  resolution: ZoneSuggestionResolution | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  skip_reason: ZoneSkipReason | null;
  created_at: string;
}

export interface ZoneSuggestion {
  evaluation_id: string;
  player_id: string;
  player_name: string;
  player_number: number;
  event_id: string;
  event_date: string;
  zone: number;
  distance_ft: number;
  period_started_at: string;
  stats: PeriodStats;
  /** Earlier demotion suggestions for this player in this league, whatever became of them. */
  previous_flags: number;
  created_at: string;
}

export interface LeagueRosterEntry {
  player_id: string;
  player_name: string;
  player_number: number;
  zone: number | null;
  distance_ft: number | null;
  period_started_at: string | null;
  stats: PeriodStats | null;
  progress: EligibilityProgress | null;
  has_open_suggestion: boolean;
}

export interface EvaluationSummaryEntry {
  player_id: string;
  player_name: string;
  zone: number;
  new_zone: number | null;
  decision: ZoneDecision;
  eligible: boolean;
  applied: boolean;
  skip_reason: ZoneSkipReason | null;
  make_pct: number | null;
  putts_attempted: number;
}

export interface EvaluationSummary {
  event_id: string;
  moved_up: EvaluationSummaryEntry[];
  moved_down: EvaluationSummaryEntry[];
  flagged: EvaluationSummaryEntry[];
  unchanged: number;
  skipped: EvaluationSummaryEntry[];
}

export interface EntryHandicapPatch {
  /** Allowed only while the entry has no recorded frames. Null clears the override. */
  putt_distance_ft?: number | null;
  exclude_from_handicap?: boolean;
  note?: string | null;
}
