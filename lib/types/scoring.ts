/**
 * Types for public scoring interface
 */

export interface PublicEventInfo {
  id: string;
  event_date: string;
  location: string | null;
  lane_count: number;
  bonus_point_enabled: boolean;
  bracket_frame_count: number;
  status: string;
}

export interface PublicMatchInfo {
  id: number; // bracket_match_id (integer)
  round_id: number;
  number: number;
  status: number;
  lane_id: string | null;
  lane_label: string | null;
  team_one: PublicTeamInfo;
  team_two: PublicTeamInfo;
  team_one_score: number;
  team_two_score: number;
  frames: PublicFrameInfo[];
}

export interface PublicTeamInfo {
  id: string;
  seed: number;
  pool_combo: string;
  players: PublicPlayerInfo[];
}

export interface PublicPlayerInfo {
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
  full_name: string;
  nickname: string | null;
}

export interface PublicFrameInfo {
  id: string;
  frame_number: number;
  is_overtime: boolean;
  results: PublicFrameResult[];
}

export interface PublicFrameResult {
  id: string;
  event_player_id: string;
  putts_made: number;
  points_earned: number;
}

/**
 * Types for admin match scoring
 */

export interface BracketMatchWithDetails {
  id: number;
  event_id: string;
  stage_id: number;
  group_id: number;
  round_id: number;
  number: number;
  status: number;
  lane_id: string | null;
  opponent1: OpponentData | null;
  opponent2: OpponentData | null;
  team_one?: TeamWithPlayers;
  team_two?: TeamWithPlayers;
  frames?: MatchFrame[];
  bracket_frame_count: number;
}

export interface OpponentData {
  id: number | null;
  score?: number;
  result?: 'win' | 'loss' | 'draw';
}

export interface TeamWithPlayers {
  id: string;
  seed: number;
  pool_combo: string;
  players: PlayerInTeam[];
}

export interface PlayerInTeam {
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
  player: {
    id: string;
    full_name: string;
    nickname: string | null;
  };
}

export interface MatchFrame {
  id: string;
  bracket_match_id: number;
  frame_number: number;
  is_overtime: boolean;
  results: FrameResult[];
}

export interface FrameResult {
  id: string;
  match_frame_id: string;
  event_player_id: string;
  bracket_match_id?: number | null;
  putts_made: number;
  points_earned: number;
  order_in_frame: number;
}

export interface RecordFrameResultInput {
  event_player_id: string;
  putts_made: number;
  points_earned: number;
  order_in_frame: number;
}

export interface MatchScores {
  team1Score: number;
  team2Score: number;
}
