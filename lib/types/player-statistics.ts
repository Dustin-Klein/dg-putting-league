import type { Player } from './player';

/**
 * Single event participation record for a player
 */
export interface PlayerEventHistory {
  eventId: string;
  eventDate: string;
  leagueId: string;
  leagueName: string;
  pool: 'A' | 'B' | null;
  placement: number | null;
  wins: number;
  losses: number;
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
}
