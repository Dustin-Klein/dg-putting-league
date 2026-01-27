import type { Player } from './player';
import type { EventStatus } from './event';

/**
 * Single event participation record for a player (completed events)
 */
export interface PlayerEventHistory {
  eventId: string;
  eventDate: string;
  leagueId: string;
  leagueName: string;
  eventLocation: string | null;
  pool: 'A' | 'B' | null;
  placement: number | null;
  wins: number;
  losses: number;
  teammateId: string | null;
  teammateName: string | null;
  seed: number | null;
}

/**
 * Ongoing event participation (non-completed events)
 */
export interface PlayerOngoingEvent {
  eventId: string;
  eventDate: string;
  leagueId: string;
  leagueName: string;
  eventLocation: string | null;
  eventStatus: EventStatus;
  pool: 'A' | 'B' | null;
  teammateId: string | null;
  teammateName: string | null;
  seed: number | null;
}

/**
 * Aggregate statistics for a player
 */
export interface PlayerStatistics {
  eventsPlayed: number;
  totalWins: number;
  totalLosses: number;
  winRate: number;
  perFrameAverage: number | null;
  perfectMatches: number;
  firstPlaceFinishes: number;
  topThreeFinishes: number;
}

/**
 * Combined player profile response
 */
export interface PlayerProfile {
  player: Player;
  statistics: PlayerStatistics;
  eventHistory: PlayerEventHistory[];
  ongoingEvents: PlayerOngoingEvent[];
}
