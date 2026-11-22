import { Status, type Match, type Round } from 'brackets-model';
import type { Lane } from '@/lib/types/bracket';

interface QueueEntry {
  id: number | string;
  number: number;
  status: number;
  round_number: number;
  updated_at?: string | null;
}

/** Shared automatic lane queue order. Null timestamps are oldest. */
export function compareMatchQueue(a: QueueEntry, b: QueueEntry): number {
  const time = (value?: string | null) => value ? new Date(value).getTime() : 0;
  return a.round_number - b.round_number ||
    b.status - a.status ||
    time(a.updated_at) - time(b.updated_at) ||
    a.number - b.number ||
    Number(a.id) - Number(b.id);
}

export type QueuedMatch = Match & { lane_id?: string | null; updated_at?: string | null };

/** Derive the next batch from the existing snapshot, without any additional reads. */
export function getOnDeckMatchIds(
  matches: QueuedMatch[],
  rounds: Round[],
  lanes: Lane[],
  eventStatus?: string,
): Set<Match['id']> {
  const usableLanes = lanes.filter(lane => lane.status !== 'maintenance' && !lane.maintenance_pending).length;
  if (eventStatus !== 'bracket' || usableLanes === 0) return new Set();
  const roundNumbers = new Map(rounds.map(round => [round.id, round.number]));
  return new Set(matches
    .filter(match => match.lane_id == null &&
      (match.status === Status.Ready || match.status === Status.Waiting) &&
      match.opponent1?.id != null && match.opponent2?.id != null &&
      roundNumbers.has(match.round_id))
    .map(match => ({ ...match, round_number: roundNumbers.get(match.round_id)! }))
    .sort(compareMatchQueue)
    .slice(0, usableLanes)
    .map(match => match.id));
}
