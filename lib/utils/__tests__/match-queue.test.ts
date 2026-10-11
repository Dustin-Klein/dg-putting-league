import { Status, type Round } from 'brackets-model';
import { compareMatchQueue, getOnDeckMatchIds, type QueuedMatch } from '../match-queue';
import type { Lane } from '@/lib/types/bracket';

const rounds = [{ id: 1, number: 1 }, { id: 2, number: 2 }] as Round[];
const lane = (status: Lane['status'] = 'occupied', pending = false): Lane => ({
  id: 'lane', event_id: 'event', label: 'Lane 1', status, maintenance_pending: pending,
});
const match = (id: number, extra: Partial<QueuedMatch> = {}): QueuedMatch => ({
  id, stage_id: 1, group_id: 1, round_id: 1, number: id, child_count: 0,
  status: Status.Ready, opponent1: { id: 0 }, opponent2: { id: 2 }, ...extra,
});
const select = (matches: QueuedMatch[], lanes = [lane()], status = 'bracket') =>
  [...getOnDeckMatchIds(matches, rounds, lanes, status)];

describe('automatic match queue', () => {
  it('orders by round, readiness, oldest update, number, then ID', () => {
    const entry = { id: 1, number: 1, status: Status.Ready, round_number: 1, updated_at: '2026-10-01' };
    for (const later of [
      { round_number: 2 }, { status: Status.Waiting }, { updated_at: '2026-10-02' }, { number: 2 }, { id: 2 },
    ]) {
      expect(compareMatchQueue(entry, { ...entry, ...later })).toBeLessThan(0);
      expect(compareMatchQueue({ ...entry, ...later }, entry)).toBeGreaterThan(0);
    }
    expect(compareMatchQueue(entry, entry)).toBe(0);
    expect(compareMatchQueue({ ...entry, updated_at: null }, entry)).toBeLessThan(0);
  });

  it('accepts participant zero and Waiting with resolved participants, without mutating the snapshot', () => {
    const matches = [match(2, { status: Status.Waiting }), match(1), match(3, { round_id: 2 })];
    expect(select(matches, [lane(), lane()])).toEqual([1, 2]);
    expect(matches.map(m => m.id)).toEqual([2, 1, 3]);
  });

  it('advances the second queued match to first when the first is assigned', () => {
    expect(select([match(2), match(1)], [lane(), lane()])).toEqual([1, 2]);
    expect(select([match(2), match(1, { lane_id: 'lane' })], [lane(), lane()])).toEqual([2]);
  });

  it('excludes assigned, unresolved, missing-round and inactive matches', () => {
    expect(select([
      match(1, { lane_id: 'lane' }), match(2, { opponent1: null }),
      match(3, { opponent2: { id: null } }), match(4, { round_id: 99 }),
      ...[Status.Locked, Status.Running, Status.Completed, Status.Archived].map((status, i) => match(i + 5, { status })),
    ])).toEqual([]);
  });

  it('counts occupied and idle lanes but excludes maintenance and pending maintenance', () => {
    expect(select([match(1), match(2), match(3)], [lane(), lane('idle'), lane('maintenance'), lane('occupied', true)])).toEqual([1, 2]);
    expect(select([match(1)], [lane(), lane()])).toEqual([1]);
    expect(select([match(1)], [])).toEqual([]);
    expect(select([match(1)], [lane('maintenance')])).toEqual([]);
    expect(select([match(1)], [lane('occupied', true)])).toEqual([]);
  });

  it('removes indicators on assignment, start, and event completion', () => {
    expect(select([match(1)])).toEqual([1]);
    expect(select([match(1, { lane_id: 'lane' })])).toEqual([]);
    expect(select([match(1, { status: Status.Running })])).toEqual([]);
    expect(select([match(1)], [lane()], 'completed')).toEqual([]);
    expect(select([match(1)], [lane()], 'pre-bracket')).toEqual([]);
  });
});
