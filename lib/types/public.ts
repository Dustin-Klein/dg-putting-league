import type { EventStatus } from './event';

export interface PublicLeague {
  id: string;
  name: string;
  description: string | null;
  event_count: number;
}

export interface PublicEvent {
  id: string;
  event_date: string;
  location: string | null;
  status: EventStatus;
  participant_count: number;
}

export interface PublicLeagueDetail extends PublicLeague {
  events: PublicEvent[];
}
