export type EventStatus = 'created' | 'pre-bracket' | 'bracket' | 'completed';

/**
 * How bracket teams are drawn. Orthogonal to team size.
 * - random_pairing: one Pool A + one Pool B player per team (doubles); one team per player at size 1
 * - random_flat: shuffle every entrant and chunk into teams of team_size; no pools
 * - manual: the organizer builds the teams; no pools
 */
export type TeamAssignment = 'random_pairing' | 'random_flat' | 'manual';

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
  entry_fee_per_player: number | null;
  admin_fees: number | null;
  admin_fee_per_player: number | null;
  payout_pool_override: number | null;
  payout_structure: PayoutPlace[] | null;
  team_size: number;
  team_assignment: TeamAssignment;
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
  bonus_point_enabled: boolean;
  qualification_round_enabled: boolean;
  bracket_frame_count: number | null;
  qualification_frame_count: number;
  double_grand_final: boolean;
  entry_fee_per_player: number | null;
  admin_fees: number | null;
  admin_fee_per_player: number | null;
  payout_pool_override: number | null;
  payout_structure: PayoutPlace[] | null;
  team_size: number;
  team_assignment: TeamAssignment;
  created_at: string;
  players: import('./player').EventPlayer[];
  teams?: import('./team').Team[];
  participant_count: number;
  league_id: string;
}

export interface UpdateEventStatusValues {
  status: EventStatus;
}
