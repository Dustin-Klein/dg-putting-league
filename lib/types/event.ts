export type EventStatus = 'created' | 'pre-bracket' | 'bracket' | 'completed';

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
  created_at: string;
  players: import('./player').EventPlayer[];
  teams?: import('./team').Team[];
  participant_count: number;
  league_id: string;
}

export interface UpdateEventStatusValues {
  status: EventStatus;
}
