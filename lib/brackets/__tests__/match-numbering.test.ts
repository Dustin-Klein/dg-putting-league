import { Status } from 'brackets-model';
import { buildMatchNumbers, isHiddenMatch } from '../match-numbering';

const team = (id: number) => ({ id });
const groups = [{ id: 1, number: 1 }, { id: 2, number: 2 }];
const rounds = [
  { id: 10, group_id: 1, number: 1 },
  { id: 11, group_id: 1, number: 2 },
  { id: 20, group_id: 2, number: 1 },
];

function match(id: number, round_id: number, number: number, extra: Record<string, unknown> = {}) {
  return { id, round_id, number, status: Status.Ready, opponent1: team(1), opponent2: team(2), ...extra };
}

describe('buildMatchNumbers', () => {
  it('numbers visible matches by group, round and match number, skipping byes', () => {
    const numbers = buildMatchNumbers(groups, rounds, [
      match(3, 11, 1),
      match(1, 10, 1, { opponent2: null }),
      match(2, 10, 2),
      match(4, 20, 1),
    ]);
    expect([...numbers]).toEqual([[2, 1], [3, 2], [4, 3]]);
  });

  it('numbers a filled bye in bracket order, moving later matches up by one', () => {
    const before = buildMatchNumbers(groups, rounds, [match(1, 10, 1, { opponent2: null }), match(2, 10, 2), match(3, 11, 1)]);
    const after = buildMatchNumbers(groups, rounds, [match(1, 10, 1), match(2, 10, 2), match(3, 11, 1)]);
    expect([...before]).toEqual([[2, 1], [3, 2]]);
    expect([...after]).toEqual([[1, 1], [2, 2], [3, 3]]);
  });
});

describe('isHiddenMatch', () => {
  it('hides byes and an unplayed archived reset, not an empty slot', () => {
    expect(isHiddenMatch({ status: Status.Locked, opponent1: null, opponent2: { id: 1 } })).toBe(true);
    expect(isHiddenMatch({ status: Status.Archived, opponent1: { id: 1 }, opponent2: { id: 2 } })).toBe(true);
    expect(isHiddenMatch({ status: Status.Archived, opponent1: { id: 1, score: 3 }, opponent2: { id: 2 } })).toBe(false);
    expect(isHiddenMatch({ status: Status.Waiting, opponent1: { id: null }, opponent2: { id: 2 } })).toBe(false);
  });
});
