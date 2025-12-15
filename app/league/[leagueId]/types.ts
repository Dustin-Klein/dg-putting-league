export type EventStatus = 'registration' | 'qualification' | 'bracket' | 'completed';

export interface Event {
  id: string;
  event_date: string;
  location: string | null;
  status: EventStatus;
  lane_count: number;
  putt_distance_ft: number;
  access_code: string;
  created_at: string;
  participant_count?: number;
}

export interface LeagueWithEvents {
  id: string;
  name: string;
  city: string | null;
  events: Event[];
}

export interface CreateEventFormValues {
  event_date: string;
  location: string;
  lane_count: number;
  putt_distance_ft: number;
  access_code: string;
}
