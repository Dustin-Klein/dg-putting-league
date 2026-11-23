import type { EventLinkType, EventStatus } from './event';
import type { ZoneDecision, ZoneSkipReason, ZoneSuggestionResolution } from './handicap';

/**
 * Event stats DTOs. Three datasets, never mixed:
 * - official results (canonical match scores, placements): W–L, margins, standings;
 * - frame performance (frame_results): make %, points per match, putts mix, 3-for-3;
 * - handicap evaluation window (admin only): the player's zone window, not this event.
 *
 * Every number is sent unrounded with the counts it comes from; the UI rounds.
 */

/** Frame performance for a player, team, zone or the field. */
export interface StatLine {
  frames: number;
  /** null when the event's putt counts aren't reliable (imported points-only scores). */
  made: number | null;
  points: number;
  threes: number | null;
  /** 0–1. */
  make_rate: number | null;
  points_per_match: number | null;
}

export interface SeasonLine {
  /** What the baseline compares like with like: "Zone 2 (27 ft)", "25 ft", or "All distances". */
  label: string;
  frames: number;
  /** null below the small-sample threshold or without reliable putt counts. */
  make_rate: number | null;
  points_per_match: number | null;
}

export interface StatsEventInfo {
  id: string;
  league_id: string;
  league_name: string;
  event_date: string;
  location: string | null;
  status: Extract<EventStatus, 'bracket' | 'completed'>;
  bonus_point_enabled: boolean;
  frames_per_match: number;
  team_size: number;
  handicap_enabled: boolean;
  putt_distance_ft: number;
  putt_counts_reliable: boolean;
  link_type: EventLinkType | null;
}

export interface LinkedEventRef {
  id: string;
  link_type: EventLinkType;
  event_date: string;
}

export interface StatsZone {
  zone: number;
  distance_ft: number;
  players: number;
}

export interface StatsMember {
  entry_id: string;
  player_number: number;
  name: string;
}

export type StandingStatus = 'playing' | 'in' | 'out';

export interface StandingRow {
  team_id: string;
  seed: number | null;
  /** Only after completion (event_placements). */
  placement: number | null;
  members: StatsMember[];
  wins: number;
  losses: number;
  /** Live only. */
  status: StandingStatus | null;
  lane: string | null;
  /** Team frame performance: summed made ÷ attempts, members' normalized points summed. */
  line: StatLine;
}

export interface PlayerRow {
  entry_id: string;
  player_number: number;
  name: string;
  zone: number | null;
  distance_ft: number;
  team_id: string | null;
  line: StatLine;
  matches: number;
  /** Most regulation-frame points in one match with a full set of regulation frames. */
  best_match: number | null;
  small_sample: boolean;
  season: SeasonLine | null;
}

export interface ZoneGroup {
  zone: number | null;
  distance_ft: number;
  /** The distance differs from the zone's event distance (an override or a mismatch). */
  off_nominal: boolean;
  players: number;
  line: StatLine;
  /** Frames by putts made [0, 1, 2, 3]; null without reliable putt counts. */
  mix: [number, number, number, number] | null;
  /** Best make % in this group among players with at least 10 frames here. */
  best: { name: string; player_number: number; make_rate: number } | null;
}

export interface MatchFact {
  match_id: number;
  /** The match's M-number on the bracket. */
  number: number | null;
  side1: string;
  side2: string;
  score1: number;
  score2: number;
  overtime: boolean;
}

export interface MatchesSection {
  /** Completed played matches (BYEs and an unused grand-final reset excluded). */
  completed: number;
  margins: { margin: number; count: number }[];
  closest: MatchFact | null;
  /** Highest combined regulation score (overrides count as official). */
  highest: MatchFact | null;
  overtime: MatchFact[];
}

export interface PublicEventStats {
  event: StatsEventInfo;
  /** Only when that event is publicly visible. */
  parent: LinkedEventRef | null;
  child: LinkedEventRef | null;
  progress: { completed: number; in_progress: number; total: number };
  counts: { players: number; teams: number; matches: number };
  zones: StatsZone[];
  field: StatLine;
  close_matches: number;
  overtime_matches: number;
  season: { field: SeasonLine | null } | null;
  standings: StandingRow[];
  players: PlayerRow[];
  zone_groups: ZoneGroup[];
  matches: MatchesSection;
  generated_at: string;
}

export type DataWarningKind =
  | 'unreliable_putts'
  | 'override_conflict'
  | 'manual_only'
  | 'zero_frames';

export interface DataWarning {
  kind: DataWarningKind;
  match_id: number | null;
  match_number: number | null;
  detail: string;
}

export type EntryFlagKind = 'excluded' | 'distance_override' | 'distance_mismatch';

export interface EntryFlag {
  entry_id: string;
  name: string;
  flag: EntryFlagKind;
  zone: number | null;
  zone_distance_ft: number | null;
  distance_ft: number;
  note: string | null;
}

export interface QualificationRow {
  entry_id: string;
  name: string;
  frames: number;
  made: number | null;
  points: number;
  make_rate: number | null;
}

export interface EvaluationRow {
  player_id: string;
  name: string;
  zone: number;
  new_zone: number | null;
  decision: ZoneDecision;
  eligible: boolean;
  applied: boolean;
  skip_reason: ZoneSkipReason | null;
  resolution: ZoneSuggestionResolution | null;
  /** The evaluation window (may include earlier events and qualification), not this event. */
  window: { putts_made: number; putts_attempted: number; make_pct: number | null; matches: number; events: number };
}

export interface AdminTeamRow {
  team_id: string;
  seed: number | null;
  placement: number | null;
  members: (StatsMember & { line: StatLine })[];
  wins: number;
  losses: number;
  line: StatLine;
  zero_frame_members: string[];
}

export interface RangeStat {
  min: number;
  max: number;
  events: number;
}

export interface EventAnalytics {
  spread: {
    player_ppf_sd: number | null;
    players_counted: number;
    team_ppm_sd: number | null;
    teams_counted: number;
    /** Same statistic across earlier completed same-type events of the league. */
    league_player_ppf_sd: RangeStat | null;
    league_team_ppm_sd: RangeStat | null;
  };
  /** Pre-event strength (sum of members' season PPF) vs. final placement; after completion only. */
  strength: {
    available: boolean;
    rho: number | null;
    teams_counted: number;
    teams_without_history: number;
    rows: { team_id: string; label: string; strength: number; placement: number }[];
  };
  scatter: { entry_id: string; name: string; zone: number | null; season_rate: number; event_rate: number }[];
}

export interface AdminEventStats extends PublicEventStats {
  /** Linked events in any state. */
  children: (LinkedEventRef & { status: EventStatus })[];
  warnings: DataWarning[];
  entry_flags: EntryFlag[];
  teams: AdminTeamRow[];
  qualification: QualificationRow[] | null;
  evaluations: { state: 'pending' | 'done' | 'none'; rows: EvaluationRow[] };
  analytics: EventAnalytics;
}
