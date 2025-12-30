export type LeagueAdminRole = 'owner' | 'admin' | 'scorer';

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
  lastEventDate: string | null;
}
