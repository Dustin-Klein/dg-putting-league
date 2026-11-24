import type { BracketFormat } from '@/lib/brackets/format';

export type EventStatus = 'created' | 'pre-bracket' | 'bracket' | 'completed';

export type { BracketFormat };

/**
 * How bracket teams are drawn. Orthogonal to team size.
 * - random_pairing: one Pool A + one Pool B player per team (doubles); one team per player at size 1
 * - random_flat: shuffle every entrant and chunk into teams of team_size; no pools
 * - manual: the organizer builds the teams; no pools
 */
export type TeamAssignment = 'random_pairing' | 'random_flat' | 'manual';

/** How a linked event relates to its parent. Only 'second_chance' is built today. */
export type EventLinkType = 'second_chance' | 'side' | 'makeup';

export const TEAM_SIZE_MIN = 1;
export const TEAM_SIZE_MAX = 4;

export interface PayoutPlace {
  place: number;
  percentage: number;
}

/**
 * Basic event type matching database schema
 */
export interface Event {
  id: string;
  event_date: string;
  location: string | null;
  status: EventStatus;
  lane_count: number;
  putt_distance_ft: number;
  qualification_round_enabled: boolean;
  bracket_frame_count: number | null;
  qualification_frame_count: number;
  double_grand_final: boolean;
  bracket_format: BracketFormat;
  /** Single elimination only: play a third-place match between the semifinal losers. */
  third_place_match: boolean;
  entry_fee_per_player: number | null;
  admin_fees: number | null;
  admin_fee_per_player: number | null;
  payout_pool_override: number | null;
  payout_structure: PayoutPlace[] | null;
  team_size: number;
  team_assignment: TeamAssignment;
  /** Set on a linked event (e.g. a second-chance tournament); links are one level deep. */
  parent_event_id: string | null;
  link_type: EventLinkType | null;
  /** Players putt from their handicap zone's distance (snapshotted from the league at creation). */
  handicap_enabled: boolean;
  created_at: string;
  participant_count?: number;
}

/**
 * Event with all related data (players, teams)
 */
export interface EventWithDetails {
  id: string;
  event_date: string;
  location: string | null;
  status: EventStatus;
  lane_count: number;
  putt_distance_ft: number;
  /** Present only for league admins (see getEventForViewer); never readable by clients directly. */
  access_code?: string | null;
  /** Whether the requesting user administers the event's league (see getEventForViewer). */
  viewer_is_admin?: boolean;
  /**
   * Admins only, while registration is reopened with "keep teams": the event_player ids of
   * each kept team. The next start keeps these pairs and pairs everyone else among themselves.
   */
  kept_teams?: string[][] | null;
  bonus_point_enabled: boolean;
  qualification_round_enabled: boolean;
  bracket_frame_count: number | null;
  qualification_frame_count: number;
  double_grand_final: boolean;
  bracket_format: BracketFormat;
  /** Single elimination only: play a third-place match between the semifinal losers. */
  third_place_match: boolean;
  entry_fee_per_player: number | null;
  admin_fees: number | null;
  admin_fee_per_player: number | null;
  payout_pool_override: number | null;
  payout_structure: PayoutPlace[] | null;
  team_size: number;
  team_assignment: TeamAssignment;
  parent_event_id: string | null;
  link_type: EventLinkType | null;
  handicap_enabled: boolean;
  created_at: string;
  players: import('./player').EventPlayer[];
  teams?: import('./team').Team[];
  participant_count: number;
  league_id: string;
}

export interface UpdateEventStatusValues {
  status: EventStatus;
}

/** A main event's view of its second chance (admin only). */
export interface SecondChanceSummary {
  /** The main event's status; a second chance can be created during bracket play or after. */
  status: EventStatus;
  /** Players knocked out of the main bracket so far (after completion: placed below the winners). */
  eliminated_count: number;
  child: { id: string; status: EventStatus; event_date: string } | null;
  can_create: boolean;
  /** A second chance can putt from zones: the main event does, or its league uses them. */
  zones_available: boolean;
}

export interface SecondChancePlayer {
  player_id: string;
  full_name: string;
}

/** A second-chance event's roster compared with who is out of the main event (admin only). */
export interface SecondChanceRoster {
  parent_event_id: string;
  parent_status: EventStatus;
  status: EventStatus;
  /** Knocked out of the main event but not entered yet. */
  pending: SecondChancePlayer[];
  /** Entered here and in the main event, but not knocked out of it (e.g. after a match reset there). */
  not_eliminated: SecondChancePlayer[];
  /** Players can be added until the second-chance bracket starts. */
  can_sync: boolean;
}

/** Bracket matches played out of those that will be played (byes and an unused final reset excluded). */
export interface MatchProgress {
  played: number;
  total: number;
}
