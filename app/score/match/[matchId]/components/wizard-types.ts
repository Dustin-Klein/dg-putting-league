/**
 * Types and constants for the match scoring wizard
 */

export const STANDARD_FRAMES = 5;
export const MIN_PUTTS = 0;
export const MAX_PUTTS = 3;

export type WizardStage = 'setup' | 'scoring' | 'review';

export interface PlayerInfo {
  event_player_id: string;
  role: 'A_pool' | 'B_pool';
  full_name: string;
  nickname: string | null;
}

export interface TeamInfo {
  id: string;
  seed: number;
  pool_combo: string;
  players: PlayerInfo[];
}

export interface FrameResult {
  id: string;
  event_player_id: string;
  putts_made: number;
  points_earned: number;
}

export interface FrameInfo {
  id: string;
  frame_number: number;
  is_overtime: boolean;
  results: FrameResult[];
}

export interface MatchInfo {
  id: string;
  bracket_match_id: number;
  round_name: string;
  status: string;
  lane_label: string | null;
  team_one: TeamInfo;
  team_two: TeamInfo;
  team_one_score: number;
  team_two_score: number;
  frames: FrameInfo[];
}

/**
 * Local state for tracking scores during wizard flow
 * Key: `${event_player_id}-${frame_number}`
 */
export type ScoreState = Map<string, number>;

/**
 * Get the score key for a player and frame
 */
export function getScoreKey(eventPlayerId: string, frameNumber: number): string {
  return `${eventPlayerId}-${frameNumber}`;
}

/**
 * Check if a frame is complete (all 4 players have scored)
 */
export function isFrameComplete(
  frameNumber: number,
  match: MatchInfo,
  localScores: ScoreState
): boolean {
  const allPlayers = [...match.team_one.players, ...match.team_two.players];

  for (const player of allPlayers) {
    const key = getScoreKey(player.event_player_id, frameNumber);
    const localScore = localScores.get(key);

    // Check local scores first, then server data
    if (localScore === undefined) {
      const frame = match.frames.find(f => f.frame_number === frameNumber);
      const result = frame?.results.find(r => r.event_player_id === player.event_player_id);
      if (result?.putts_made === undefined) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Calculate team score for a specific frame
 */
export function getTeamFrameScore(
  team: TeamInfo,
  frameNumber: number,
  match: MatchInfo,
  localScores: ScoreState,
  bonusPointEnabled: boolean
): number {
  let total = 0;
  const frame = match.frames.find(f => f.frame_number === frameNumber);

  for (const player of team.players) {
    const key = getScoreKey(player.event_player_id, frameNumber);
    const localScore = localScores.get(key);

    let putts: number | undefined;
    if (localScore !== undefined) {
      putts = localScore;
    } else {
      const result = frame?.results.find(r => r.event_player_id === player.event_player_id);
      putts = result?.putts_made;
    }

    if (putts !== undefined) {
      total += calculatePoints(putts, bonusPointEnabled);
    }
  }

  return total;
}

/**
 * Calculate points from putts made
 */
export function calculatePoints(puttsMade: number, bonusPointEnabled: boolean): number {
  if (puttsMade < 3) return puttsMade;
  return bonusPointEnabled ? 4 : 3;
}

/**
 * Get all players from both teams
 */
export function getAllPlayers(match: MatchInfo): PlayerInfo[] {
  return [...match.team_one.players, ...match.team_two.players];
}

/**
 * Check if scores are tied after all frames
 */
export function areScoresTied(match: MatchInfo): boolean {
  return match.team_one_score === match.team_two_score;
}

/**
 * Determine if overtime is needed
 */
export function needsOvertime(match: MatchInfo): boolean {
  return (
    areScoresTied(match) &&
    match.frames.length >= STANDARD_FRAMES &&
    match.frames.every(f => f.results.length === 4)
  );
}

/**
 * Get the maximum frame number to display
 */
export function getMaxFrameNumber(match: MatchInfo): number {
  return Math.max(
    STANDARD_FRAMES,
    ...match.frames.map(f => f.frame_number)
  );
}

/**
 * Get all frame numbers that should be available
 */
export function getFrameNumbers(match: MatchInfo): number[] {
  const maxFrame = getMaxFrameNumber(match);
  const frames = Array.from({ length: maxFrame }, (_, i) => i + 1);

  // Add overtime frame if needed
  if (needsOvertime(match) && frames.length === maxFrame) {
    frames.push(maxFrame + 1);
  }

  return frames;
}

/**
 * Check if a frame is an overtime frame
 */
export function isOvertimeFrame(frameNumber: number): boolean {
  return frameNumber > STANDARD_FRAMES;
}

/**
 * Calculate total team score across all frames, including local scores
 */
export function getTotalTeamScore(
  team: TeamInfo,
  match: MatchInfo,
  localScores: ScoreState,
  bonusPointEnabled: boolean
): number {
  let total = 0;

  // Get max frame from server data
  let maxFrame = Math.max(STANDARD_FRAMES, ...match.frames.map(f => f.frame_number));

  // Also check local scores for frames not yet on server (e.g., new overtime frame)
  for (const key of localScores.keys()) {
    const frameNumber = parseInt(key.split('-').pop() || '0', 10);
    if (frameNumber > maxFrame) {
      maxFrame = frameNumber;
    }
  }

  for (let frameNumber = 1; frameNumber <= maxFrame; frameNumber++) {
    total += getTeamFrameScore(team, frameNumber, match, localScores, bonusPointEnabled);
  }

  return total;
}

/**
 * Check if scores are tied using local scores for accurate detection
 */
export function areScoresTiedWithLocalScores(
  match: MatchInfo,
  localScores: ScoreState,
  bonusPointEnabled: boolean
): boolean {
  const teamOneTotal = getTotalTeamScore(match.team_one, match, localScores, bonusPointEnabled);
  const teamTwoTotal = getTotalTeamScore(match.team_two, match, localScores, bonusPointEnabled);
  return teamOneTotal === teamTwoTotal;
}
