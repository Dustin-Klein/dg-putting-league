import type { EventLinkType, EventStatus, MatchProgress } from './event';
import type { LeagueSeason } from './league';

export interface PublicLeague {
  id: string;
  name: string;
  event_count: number;
}

/** `scheduled` and `qualifying` mean an event not yet in bracket play; `idle`, every event is done. */
export type PublicLeagueStatus = 'live' | 'qualifying' | 'scheduled' | 'idle';

export interface PublicLeagueSummary extends PublicLeague {
  city: string | null;
  season: LeagueSeason;
  status: PublicLeagueStatus;
  /** The live night's events in bracket play, main event first. */
  live_events: Array<{ id: string; second_chance: boolean; match_progress: MatchProgress | null }>;
}

export interface PublicEvent {
  id: string;
  event_date: string;
  location: string | null;
  status: EventStatus;
  participant_count: number;
  parent_event_id: string | null;
  link_type: EventLinkType | null;
  /** Only while the event is in bracket play. */
  match_progress: MatchProgress | null;
}

export interface PublicLeagueDetail extends PublicLeague {
  city: string | null;
  events: PublicEvent[];
}
