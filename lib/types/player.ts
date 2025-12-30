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
  has_paid: boolean;
  pool?: 'A' | 'B' | null;
  pfa_score?: number | null;
  scoring_method?: 'qualification' | 'pfa' | 'default' | null;
  created_at: string;
  player: Player;
}

export interface SearchPlayerResponse {
  results: Player[];
  hasMore: boolean;
}

export interface AddPlayerFormValues {
  name: string;
  email?: string;
  pdga_number?: string;
  phone_number?: string;
}
