export type EventStatus = 'created' | 'pre-bracket' | 'bracket' | 'completed';

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
  access_code: string;
  qualification_round_enabled: boolean;
  bracket_frame_count: number;
  qualification_frame_count: number;
  entry_fee_per_player: number | null;
  admin_fees: number | null;
  admin_fee_per_player: number | null;
  payout_pool_override: number | null;
  payout_structure: PayoutPlace[] | null;
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
  access_code: string;
  bonus_point_enabled: boolean;
  qualification_round_enabled: boolean;
  bracket_frame_count: number;
  qualification_frame_count: number;
  entry_fee_per_player: number | null;
  admin_fees: number | null;
  admin_fee_per_player: number | null;
  payout_pool_override: number | null;
  payout_structure: PayoutPlace[] | null;
  created_at: string;
  players: import('./player').EventPlayer[];
  teams?: import('./team').Team[];
  participant_count: number;
  league_id: string;
}

export interface UpdateEventStatusValues {
  status: EventStatus;
}
