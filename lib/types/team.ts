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
