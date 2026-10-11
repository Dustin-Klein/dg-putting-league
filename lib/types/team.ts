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

