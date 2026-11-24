import { Status } from 'brackets-model';
import type { BracketWithTeams } from '@/lib/types/bracket';
import { bracketProgress, headerStats, matchProgress } from '../event-progress';

type MatchSpec = {
  id: number;
  round: number;
  a: number | null | 'bye';
  b: number | null | 'bye';
  status: Status;
  winner?: 'a' | 'b';
};

function bracket(matches: MatchSpec[], lanes: Array<{ label: string; status: 'idle' | 'occupied' | 'maintenance' }> = []) {
  const opponent = (value: number | null | 'bye', result?: string) =>
    (value === 'bye' ? null : { id: value, ...(result ? { result } : {}) });
  return {
    bracket: {
      stage: {},
      groups: [{ id: 0, number: 1 }, { id: 1, number: 2 }, { id: 2, number: 3 }],
      rounds: [
        { id: 10, group_id: 0, number: 1 },
        { id: 20, group_id: 2, number: 1 },
        { id: 21, group_id: 2, number: 2 },
      ],
      matches: matches.map((match) => ({
        id: match.id,
        round_id: match.round,
        opponent1: opponent(match.a, match.winner ? (match.winner === 'a' ? 'win' : 'loss') : undefined),
        opponent2: opponent(match.b, match.winner ? (match.winner === 'b' ? 'win' : 'loss') : undefined),
        status: match.status,
      })),
      participants: [],
    },
    teams: [{}, {}, {}, {}],
    participantTeamMap: {},
    lanes: lanes.map((lane, index) => ({ id: `lane-${index}`, event_id: 'e', maintenance_pending: false, ...lane })),
    laneMap: {},
  } as unknown as BracketWithTeams;
}

describe('bracketProgress', () => {
  it('counts played matches, ignoring byes and an unused grand-final reset', () => {
    const progress = bracketProgress(bracket([
      { id: 1, round: 10, a: 1, b: 2, status: Status.Completed },
      { id: 2, round: 10, a: 3, b: 'bye', status: Status.Completed },
      { id: 3, round: 10, a: 4, b: 5, status: Status.Running },
      { id: 4, round: 20, a: null, b: null, status: Status.Locked },
      { id: 5, round: 21, a: null, b: null, status: Status.Locked },
    ]));
    expect(progress).toMatchObject({ played: 1, total: 3, teams: 4 });
  });

  it('counts the reset only when the losers-bracket team won the first final', () => {
    expect(bracketProgress(bracket([
      { id: 4, round: 20, a: 1, b: 2, status: Status.Completed, winner: 'b' },
      { id: 5, round: 21, a: 1, b: 2, status: Status.Ready },
    ]))).toMatchObject({ played: 1, total: 2 });
  });

  it('ignores an unused reset that was archived with both teams in it', () => {
    expect(bracketProgress(bracket([
      { id: 4, round: 20, a: 1, b: 2, status: Status.Completed, winner: 'a' },
      { id: 5, round: 21, a: 1, b: 2, status: Status.Archived },
    ]))).toMatchObject({ played: 1, total: 1 });
  });

  it('never counts the reset once the event switched to a single grand final', () => {
    const { bracket: data } = bracket([
      { id: 4, round: 20, a: 1, b: 2, status: Status.Completed, winner: 'b' },
      { id: 5, round: 21, a: 1, b: 2, status: Status.Archived },
    ]);
    expect(matchProgress(data, false)).toEqual({ played: 1, total: 1 });
  });

  it('orders lanes and tells in-play, open and maintenance lanes apart', () => {
    const progress = bracketProgress(bracket([], [
      { label: 'Lane 10', status: 'idle' },
      { label: 'Lane 2', status: 'occupied' },
      { label: 'Lane 1', status: 'maintenance' },
    ]));
    expect(progress.lanes.map((lane) => [lane.label, lane.state])).toEqual([
      ['Lane 1', 'maintenance'],
      ['Lane 2', 'in_play'],
      ['Lane 10', 'open'],
    ]);
    expect(progress).toMatchObject({ lanesInPlay: 1, lanesInMaintenance: 1 });
  });

  it('keeps lanes lent to the second chance in line, marked lent', () => {
    const data = bracket([], [{ label: 'Lane 1', status: 'occupied' }, { label: 'Lane 3', status: 'idle' }]);
    data.lentLanes = [{ id: 'lent', label: 'Lane 2', status: 'occupied' }];
    const progress = bracketProgress(data);
    expect(progress.lanes.map((lane) => [lane.label, lane.state])).toEqual([
      ['Lane 1', 'in_play'],
      ['Lane 2', 'lent'],
      ['Lane 3', 'open'],
    ]);
    expect(progress).toMatchObject({ lanesInPlay: 1, lanesLent: 1 });
  });
});

describe('headerStats', () => {
  it('shows money only to admins of a paid event', () => {
    expect(headerStats({ status: 'pre-bracket', entry_fee_per_player: 10 }, true)).toEqual(['players', 'pot', 'lanes', 'distance']);
    expect(headerStats({ status: 'pre-bracket', entry_fee_per_player: null }, true)).toEqual(['players', 'lanes', 'distance']);
    expect(headerStats({ status: 'created', entry_fee_per_player: 10 }, false)).toEqual(['players', 'lanes', 'distance']);
  });

  it('switches to live numbers during the bracket', () => {
    expect(headerStats({ status: 'bracket', entry_fee_per_player: 10 }, true)).toEqual(['matches', 'lanes_live', 'teams', 'distance']);
    expect(headerStats({ status: 'completed', entry_fee_per_player: 10 }, true)).toEqual(['players', 'pot', 'distance']);
  });
});
