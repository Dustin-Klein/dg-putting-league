import type { EventLinkType, EventStatus, MatchProgress } from './event';

export type LeagueAdminRole = 'owner' | 'admin';

/**
 * League type with aggregated counts from database query
 */
export interface League {
  id: string;
  name: string;
  city: string | null;
  created_at: string;
  events: { count: number }[];
  active_events: { count: number }[];
  last_event: Array<{ event_date: string | null }>;
}

/**
 * Processed league type with role and computed counts
 */
export interface LeagueWithRole extends Omit<League, 'events' | 'active_events' | 'last_event'> {
  role: LeagueAdminRole;
  eventCount: number;
  activeEventCount: number;
  season: LeagueSeason;
  currentNight: LeagueCurrentNight | null;
}

/** A league night's state: any event in bracket play, main event completed, or neither. */
export type NightState = 'live' | 'done' | 'upcoming';

export interface LeagueSeason {
  first_event_date: string | null;
  latest_event_date: string | null;
  night_count: number;
  /** The latest nights, oldest first. */
  nights: NightState[];
}

export interface LeagueNightEvent {
  id: string;
  event_date: string;
  status: EventStatus;
  link_type: EventLinkType | null;
  qualification_round_enabled: boolean;
  participant_count: number;
  paid_count: number;
  lane_count: number;
  entry_fee_per_player: number | null;
  match_progress: MatchProgress | null;
  borrowed_lane_labels: string[];
}

export interface LeagueCurrentNight {
  kind: 'live' | 'next' | 'latest';
  main: LeagueNightEvent;
  secondChances: LeagueNightEvent[];
}
