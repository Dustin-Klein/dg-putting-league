import { EventStatus } from '@/app/league/[leagueId]/types';

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

export interface TeamMember {
  team_id: string;
  event_player_id: string;
  role: 'A_pool' | 'B_pool' | 'alternate';
  joined_at: string;
  event_player: EventPlayer;
}

export interface Team {
  id: string;
  event_id: string;
  seed: number;
  pool_combo: string;
  created_at: string;
  team_members: TeamMember[];
}

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
  players: EventPlayer[];
  teams?: Team[];
  participant_count: number;
  league_id: string;
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

export interface UpdateEventStatusValues {
  status: EventStatus;
}
