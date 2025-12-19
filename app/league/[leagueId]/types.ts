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

