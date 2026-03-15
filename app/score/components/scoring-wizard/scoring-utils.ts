export const MIN_PUTTS = 0;
export const MAX_PUTTS = 3;

export type ScoreState = Map<string, number>;

export interface PersistedFrameScore {
  event_player_id: string;
  putts_made: number;
  points_earned?: number;
}

export interface PersistedFrame<TScore extends PersistedFrameScore = PersistedFrameScore> {
  frame_number: number;
  results: TScore[];
}

export interface ScoreParticipant {
  event_player_id: string;
}

export function getScoreKey(eventPlayerId: string, frameNumber: number): string {
  return `${eventPlayerId}-${frameNumber}`;
}

export function calculatePoints(puttsMade: number, bonusPointEnabled: boolean): number {
  if (puttsMade < MAX_PUTTS) {
    return puttsMade;
  }

  return bonusPointEnabled ? 4 : MAX_PUTTS;
}

export function getResolvedScore<TFrame extends PersistedFrame>(
  eventPlayerId: string,
  frameNumber: number,
  localScores: ScoreState,
  frames: TFrame[]
): number | null {
  const key = getScoreKey(eventPlayerId, frameNumber);
  const localScore = localScores.get(key);

  if (localScore !== undefined) {
    return localScore;
  }

  const frame = frames.find((item) => item.frame_number === frameNumber);
  const result = frame?.results.find((item) => item.event_player_id === eventPlayerId);

  return result?.putts_made ?? null;
}

export function isFrameComplete<TParticipant extends ScoreParticipant, TFrame extends PersistedFrame>(
  participants: TParticipant[],
  frameNumber: number,
  localScores: ScoreState,
  frames: TFrame[]
): boolean {
  return participants.every((participant) =>
    getResolvedScore(participant.event_player_id, frameNumber, localScores, frames) !== null
  );
}

export function getMaxFrameNumber<TFrame extends PersistedFrame>(
  frames: TFrame[],
  minimumFrameCount: number
): number {
  if (frames.length === 0) {
    return minimumFrameCount;
  }

  return Math.max(minimumFrameCount, ...frames.map((frame) => frame.frame_number));
}

export function getSequentialFrameNumbers<TFrame extends PersistedFrame>(
  frames: TFrame[],
  minimumFrameCount: number
): number[] {
  const maxFrame = getMaxFrameNumber(frames, minimumFrameCount);
  return Array.from({ length: maxFrame }, (_, index) => index + 1);
}
