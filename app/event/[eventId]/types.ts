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
  created_at: string;
  player: Player;
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
  created_at: string;
  players: EventPlayer[];
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
