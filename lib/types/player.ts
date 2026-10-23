export type PaymentType = 'cash' | 'electronic';

/**
 * Player from the players table
 */
export interface Player {
  id: string;
  full_name: string;
  nickname?: string | null;
  email?: string | null;
  created_at: string;
  default_pool?: 'A' | 'B' | null;
  player_number?: number | null;
  // Computed display field (not in database)
  display_identifier?: string;
}

/**
 * Player enrolled in a specific event
 */
export interface EventPlayer {
  id: string;
  event_id: string;
  player_id: string;
  payment_type: PaymentType | null;
  pool?: 'A' | 'B' | null;
  pfa_score?: number | null;
  scoring_method?: 'qualification' | 'pfa' | 'default' | null;
  /** Handicap zone this entry putts from (snapshot); null when the event has no handicaps. */
  zone?: number | null;
  /** Distance this entry putts from: the zone's distance at this event, or the event distance. */
  putt_distance_ft?: number;
  /** Admin-only: the organizer decided this entry doesn't count toward the handicap. */
  exclude_from_handicap?: boolean;
  /** Admin-only. */
  handicap_note?: string | null;
  /** Admin-only: the distance was set by hand for this entry. */
  distance_override?: boolean;
  created_at: string;
  player: Player;
}

export interface SearchPlayerResponse {
  results: Player[];
  hasMore: boolean;
}

/**
 * Player search result (lightweight version for search endpoints)
 */
export interface PlayerSearchResult {
  id: string;
  full_name: string;
  player_number: number | null;
}

export interface AddPlayerFormValues {
  name: string;
  email?: string;
  pdga_number?: string;
  phone_number?: string;
}
