export type EventStatus = 'registration' | 'qualification' | 'bracket' | 'completed';

export interface Event {
  id: string;
  league_id: string;
  event_date: string; // ISO date string
  location?: string;
  lane_count: number;
  putt_distance_ft: number;
  access_code: string;
  bonus_point_enabled: boolean;
  status: EventStatus;
  created_at: string; // ISO date string
}

export interface EventWithDetails extends Event {
  participant_count?: number;
  // Add any additional fields you need for the events list
}
