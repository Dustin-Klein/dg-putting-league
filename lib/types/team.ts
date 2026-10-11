import type { EventPlayer } from './player';

/**
 * Team member assignment
 */
export interface TeamMember {
  team_id: string;
  event_player_id: string;
  role: 'A_pool' | 'B_pool' | 'alternate';
  joined_at: string;
  event_player: EventPlayer;
}

/**
 * Team in an event bracket
 */
export interface Team {
  id: string;
  event_id: string;
  seed: number;
  pool_combo: string;
  created_at: string;
  team_members: TeamMember[];
}

/**
 * One member of a previewed or submitted team. `slot` (1..team size) is the
 * member's position: render order, and Pool A = 1 / Pool B = 2 for pool-paired doubles.
 */
export interface TeamMemberPairing {
  eventPlayerId: string;
  slot: number;
}

/**
 * A team as previewed and as submitted at bracket start. The server recomputes
 * seed, poolCombo and combinedScore from the members.
 */
export interface TeamPairing {
  seed: number;
  poolCombo: string;
  combinedScore: number;
  members: TeamMemberPairing[];
}

/**
 * A player as the team preview shows them: server-computed score, and a pool
 * only for the random doubles draw.
 */
export interface TeamPreviewPlayer {
  eventPlayerId: string;
  playerName: string;
  pfaScore: number;
  scoringMethod: 'qualification' | 'pfa' | 'default';
  pool: 'A' | 'B' | null;
}

/**
 * Team preview response. `teamPairings` is the server's draw, or empty under manual
 * assignment, where the organizer builds the teams from `players`.
 */
export interface TeamPreview {
  teamSize: number;
  teamAssignment: import('./event').TeamAssignment;
  players: TeamPreviewPlayer[];
  teamPairings: TeamPairing[];
}
