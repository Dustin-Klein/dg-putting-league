import type { EventLinkType, EventStatus, MatchProgress } from './event';

export interface PublicLeague {
  id: string;
  name: string;
  event_count: number;
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
