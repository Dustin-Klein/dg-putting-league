/**
 * Which bracket matches were actually played. Pure: importable from services,
 * repositories and client components.
 */
import { Status } from 'brackets-model';

interface OpponentSlot {
  id?: number | null;
  result?: string | null;
}

export interface MatchSlots {
  opponent1: unknown;
  opponent2: unknown;
}

function slot(value: unknown): OpponentSlot | null {
  return value && typeof value === 'object' ? (value as OpponentSlot) : null;
}

/** A BYE: brackets-manager stores the missing side as `null` (a TBD side is `{ id: null }`). */
export function isByeMatch(match: MatchSlots): boolean {
  return match.opponent1 === null || match.opponent2 === null;
}

function hasBothParticipants(match: MatchSlots): boolean {
  return slot(match.opponent1)?.id != null && slot(match.opponent2)?.id != null;
}

function hasResult(match: MatchSlots): boolean {
  const decided = (value: unknown) => {
    const result = slot(value)?.result;
    return result === 'win' || result === 'loss' || result === 'draw';
  };
  return decided(match.opponent1) || decided(match.opponent2);
}

export type PlayedMatchState = 'completed' | 'in_progress';

/**
 * The one predicate every match-based number uses: two real participants, and either
 * finished with a result or (live) running with at least one frame. Excludes BYEs and
 * an archived grand-final reset that was never needed (archived, no result).
 */
export function playedMatchState(
  match: MatchSlots & { status: number },
  frameCount: number
): PlayedMatchState | null {
  if (isByeMatch(match) || !hasBothParticipants(match)) return null;
  if (match.status === Status.Completed || match.status === Status.Archived) {
    return hasResult(match) ? 'completed' : null;
  }
  return frameCount > 0 ? 'in_progress' : null;
}

/**
 * Whether a match counts toward "N of M matches": played, or still to be played. A
 * grand-final reset counts only once it's in play (it stays locked until the first
 * grand final decides whether it's needed).
 */
export function isScheduledMatch(
  match: MatchSlots & { status: number },
  frameCount: number,
  opts: { isGrandFinalReset: boolean }
): boolean {
  if (playedMatchState(match, frameCount) !== null) return true;
  if (isByeMatch(match)) return false;
  if (match.status === Status.Completed || match.status === Status.Archived) return false;
  if (opts.isGrandFinalReset && match.status === Status.Locked) return false;
  return true;
}
